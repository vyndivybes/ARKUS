import base64
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from build import index_notes, retrieve
from focus import Focus, LEDGER_KEYS
from server import App, UserError, make_server


class ArkusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {'ARKUS_CONFIG': str(self.root / 'no-config.json')})
        self.env.start()
        self.app = App(self.root)

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_ids_links_and_title_weight(self):
        graph = self.app.graph
        self.assertEqual(len(graph['nodes']), 30)
        self.assertEqual([n['id'] for n in graph['nodes']], list(range(30)))
        self.assertTrue(graph['links'])
        self.assertEqual(retrieve(graph, 'payment terms')[0]['label'], 'Payment terms')

    def test_capture_immediately_searchable_and_ids_stable_after_restart(self):
        before = {n['file']: n['id'] for n in self.app.graph['nodes']}
        result = self.app.remember('remember that zephyrquantum finish window must be 900 milliseconds')
        self.assertEqual(result['nodes'], [30])
        self.assertTrue(list((self.app.notes / 'captures').glob('*.md')))
        for node in self.app.graph['nodes'][:30]:
            self.assertEqual(node['id'], before[node['file']])
        answer = self.app.chat('zephyrquantum finish window')
        self.assertIn(30, answer['nodes'])
        self.assertIn('900', answer['answer'])
        restarted = App(self.root)
        self.assertIn('900', restarted.chat('zephyrquantum')['answer'])

    def test_capture_failure_never_confirmed(self):
        (self.app.notes / 'captures').write_text('blocked')
        with self.assertRaises(OSError):
            self.app.remember('a thought that must not vanish')

    def test_smalltalk_and_unknown_sources(self):
        self.assertEqual(self.app.chat('Good morning')['nodes'], [])
        self.assertEqual(self.app.chat('zyxnonexistent astrophysics')['kind'], 'uncovered')

    def test_help_is_actionable_and_offline_unknown_is_honest(self):
        result = self.app.chat('What can you do?')
        self.assertEqual(result['kind'], 'help')
        self.assertIn('Ollama', result['answer'])
        self.assertEqual(result['nodes'], [])
        with patch('server.retrieve', return_value=[]):
            unknown = self.app.chat('Explain how nuclear fusion works.')
        self.assertEqual(unknown['kind'], 'uncovered')
        self.assertIn('not a conversational AI', unknown['answer'])

    def test_configured_model_answers_general_questions_without_fabricated_sources(self):
        self.app.provider = 'ollama'
        self.app.model = 'verified-local-model'
        self.app.verified.add(self.app.model)
        with patch('server.retrieve', return_value=[]), patch.object(self.app, 'completion', return_value='Nuclear fusion joins light nuclei.') as completion:
            first = self.app.chat('Explain nuclear fusion in one sentence')
            follow = self.app.chat('Explain it more simply')
        self.assertEqual(first['kind'], 'general')
        self.assertEqual(first['nodes'], [])
        self.assertIn('Nuclear fusion', first['answer'])
        self.assertEqual(follow['kind'], 'general')
        self.assertEqual(follow['nodes'], [])
        self.assertEqual(completion.call_count, 2)
        history = completion.call_args.args[0]
        self.assertTrue(any(msg['role'] == 'assistant' and 'Nuclear fusion' in msg['content'] for msg in history))

    def test_configured_model_can_answer_greetings(self):
        self.app.provider = 'ollama'
        self.app.model = 'verified-local-model'
        self.app.verified.add(self.app.model)
        with patch('server.retrieve', return_value=[]), patch.object(self.app, 'completion', return_value='Good morning!'):
            reply = self.app.chat('Good morning')
        self.assertEqual(reply['kind'], 'general')
        self.assertEqual(reply['answer'], 'Good morning!')

    def test_model_no_near_match_no_cost_by_default(self):
        with self.assertRaises(UserError):
            self.app.swap('astra version 987')
        self.assertEqual(self.app.model, 'offline')
        self.app.provider = 'openai'
        with self.assertRaisesRegex(UserError, 'paid or unknown'):
            self.app.permit_cost('made-up')
        self.app.catalog = {'real/model': {'id': 'real/model'}}
        with self.assertRaisesRegex(UserError, 'Exact model'):
            self.app.verify_model('real/model-v999')

    def test_vision_requires_consent_jpeg_and_cloud(self):
        with self.assertRaisesRegex(UserError, 'consent'):
            self.app.see({'source': 'screen'})
        with self.assertRaisesRegex(UserError, 'image/jpeg'):
            self.app.see({'source': 'screen', 'consent': True, 'image': 'data:image/png;base64,abcd'})
        with self.assertRaisesRegex(UserError, 'no vision'):
            self.app.see({'source': 'screen', 'consent': True, 'image': 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xfftest\xff\xd9').decode(), 'question': 'what is visible'})

    def test_cloud_citations_validated(self):
        self.app.provider = 'ollama'
        self.app.model = 'test'
        self.app.verified.add('test')
        with patch.object(self.app, 'completion', return_value='{"answer":"invented", "nodes":[99999]}'):
            with self.assertRaisesRegex(UserError, 'valid grounded citations'):
                self.app.chat('payment terms')


class FocusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 100.
        self.engine = Focus(Path(self.temp.name) / 'ledger.jsonl', lambda: self.now)

    def tearDown(self):
        self.temp.cleanup()

    def advance(self, sample=None, seconds=1):
        self.now += seconds
        if sample is not None:
            self.engine.sample(sample)
        self.engine.tick()

    def test_timer_does_not_claim_attention(self):
        e = self.engine
        e.command('start', {'duration': 10})
        self.advance(seconds=10)
        self.assertFalse(e.on)
        self.assertEqual(e.report['on_target_minutes'], 0)
        self.assertEqual(e.report['percent'], 0)

    def test_defer_settle_drift_privacy_retarget_and_ledger(self):
        e = self.engine
        home = {'app': 'private-home', 'home': True, 'readable': True}
        work = {'app': 'private-work', 'home': False, 'readable': True}
        away = {'app': 'private-away', 'home': False, 'readable': True, 'label': 'NEVER_STORE_FICTION_721938'}
        e.sample(home)
        e.command('start', {'duration': 60})
        self.advance(home)
        self.assertTrue(e.deferred)
        self.advance(work)
        self.assertEqual(e.settle, 1)
        self.advance(work)
        self.assertFalse(e.deferred)
        self.assertTrue(e.is_target())
        self.advance(away)
        self.advance(away)
        self.assertEqual(e.drifts, 1)
        public = json.dumps([e.state(), e.diag()])
        for secret in ('private-work', 'private-away', 'NEVER_STORE_FICTION_721938'):
            self.assertNotIn(secret, public)
        e.command('excuse', {})
        self.assertEqual(e.drifts, 0)
        self.advance(away)
        self.assertEqual(e.drifts, 0)
        e.command('retarget', {'from_card': True})
        self.assertTrue(e.deferred)
        self.advance(work)
        self.advance(work)
        e.command('abort', {})
        record = json.loads(e.ledger.read_text())
        self.assertEqual(set(record), LEDGER_KEYS)
        self.assertNotIn('NEVER_STORE_FICTION_721938', e.ledger.read_text())
        self.assertFalse(list(Path(self.temp.name).glob('*.md')))

    def test_stale_sensor_never_locks_or_reports_target(self):
        e = self.engine
        e.sample({'app': 'work', 'readable': True})
        e.command('start', {'duration': 100})
        self.advance(seconds=5)
        self.assertTrue(e.deferred)
        self.assertFalse(e.is_target())
        self.advance(seconds=45)
        self.assertEqual(e.mode, 'timer')
        self.assertFalse(e.deferred)

    def test_same_foreground_sample_cannot_settle_twice(self):
        e = self.engine
        e.sample({'app': 'work', 'readable': True})
        e.command('start', {'duration': 100})
        self.advance({'app': 'work', 'readable': True})
        self.advance()
        self.assertTrue(e.deferred)
        self.assertEqual(e.settle, 1)
        self.advance({'app': 'work', 'readable': True})
        self.assertFalse(e.deferred)

    def test_excuse_refunds_only_current_credited_excursion(self):
        e = self.engine
        work = {'app': 'work', 'readable': True}
        away = {'app': 'away', 'readable': True}
        e.sample(work)
        e.command('start', {'duration': 100})
        self.advance(work)
        self.advance(work)
        self.advance(away)
        self.advance(away)
        self.advance(work)
        previous = e.adrift
        self.advance(away)
        e.command('pause', {})
        self.advance(seconds=25)
        e.command('excuse', {})
        self.assertEqual(e.adrift, previous)

    def test_posture_booleans_cooldown_relief_and_clear(self):
        e = self.engine
        e.command('start', {'duration': 100})
        sample = {'present': True, 'head_down': True, 'slouched': False}
        e.sample_posture(sample)
        self.advance()
        e.sample_posture(sample)
        self.advance()
        self.assertTrue(e.posture_drift())
        events = e.drain()['events']
        self.assertTrue(any('posture reset' in v['text'] for v in events))
        e.command('relief', {})
        e.drain()
        e.sample_posture(sample)
        self.advance(seconds=31)
        self.assertEqual(e.drain()['events'], [])
        e.sample_posture({'enabled': False})
        self.assertFalse(e.posture_drift())
        with self.assertRaises(ValueError):
            e.sample_posture({'frame': 'NEVER_ACCEPT'})

    def test_pause_reload_and_relief(self):
        e = self.engine
        e.command('start', {'duration': 60})
        self.advance(seconds=10)
        e.command('pause', {})
        remaining = e.state()['remaining']
        self.advance(seconds=20)
        self.assertEqual(e.state()['remaining'], remaining)
        e.command('resume', {})
        self.advance(seconds=5)
        self.assertEqual(e.state()['remaining'], 45)
        e.command('relief', {})
        self.assertEqual(e.relief_until, self.now + 180)
        e.command('pause', {})
        e.command('abort', {})
        self.assertFalse(e.state()['paused'])
        self.assertFalse(e.state()['on'])

    def test_ephemeral_labels_expire_without_viewer_polling(self):
        e = self.engine
        e.emit('NEVER_RETAIN_81239')
        e.sample({'label': 'NEVER_RETAIN_81239', 'readable': True})
        with patch('focus.NAME_DISTRACTIONS', False):
            self.advance(seconds=6)
        self.assertNotIn('NEVER_RETAIN_81239', json.dumps(e.sensor))
        self.assertEqual(e.events, [])


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        with patch.dict(os.environ, {'ARKUS_CONFIG': str(Path(cls.temp.name) / 'missing')}):
            cls.app = App(cls.temp.name)
        cls.server = make_server(0, cls.app)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.temp.cleanup()

    def request(self, path, body=None, token=None, origin=None):
        headers = {}
        if token:
            headers['X-Arkus-Token'] = token
        if origin:
            headers['Origin'] = origin
        if body is not None:
            headers['Content-Type'] = 'application/json'
        return urllib.request.urlopen(urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers))

    def test_http_private_files_blocked(self):
        for path in ('/config.json', '/../server.py', '/%2e%2e/config.json', '/data/focus-ledger.jsonl', '/vendor/../../config.json'):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.request(path)
            self.assertEqual(cm.exception.code, 404)
            cm.exception.close()

    def test_csrf_and_cross_origin_refused(self):
        for token, origin in ((None, None), (self.app.token, 'https://attacker.example')):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.request('/remember', {'text': 'bad mutation'}, token, origin)
            self.assertEqual(cm.exception.code, 403)
            cm.exception.close()

    def test_real_http_remember_then_chat(self):
        with self.request('/api/session') as response:
            token = json.load(response)['token']
        with self.request('/remember', {'text': 'orbitalbanana means the deadline is Friday'}, token) as response:
            capture = json.load(response)
        with self.request('/chat', {'question': 'orbitalbanana deadline'}, token) as response:
            result = json.load(response)
        self.assertIn(capture['nodes'][0], result['nodes'])
        self.assertIn('Friday', result['answer'])


if __name__ == '__main__':
    unittest.main()
