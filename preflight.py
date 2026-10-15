"""Live checks against the running server; --live permits real provider calls.

Default mode exercises free offline chains. Cloud checks are explicit WARNs unless
--live is supplied; missing credentials then FAIL instead of pretending success.
"""
import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def run(base, live=False, jpeg=None):
    counts = {'pass': 0, 'fail': 0, 'warn': 0}
    token = None

    def verdict(kind, label):
        counts[kind] += 1
        print(f'{kind.upper()} {label}')

    def request(route, body=None):
        headers = {'Content-Type': 'application/json', 'X-Arkus-Token': token or ''}
        req = urllib.request.Request(base + route, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read()

    def check(label, callback):
        try:
            if callback() is False:
                raise ValueError('criterion not met')
            verdict('pass', label)
            return True
        except Exception as exc:
            verdict('fail', f'{label}: {type(exc).__name__}')
            return False

    if not check('Viewer served by running server', lambda: b'ARKUS' in request('/')):
        print(f"{counts['pass']} pass, {counts['fail']} fail, {counts['warn']} warn")
        return 1
    try:
        token = json.loads(request('/api/session'))['token']
        status = json.loads(request('/api/status'))
    except Exception:
        verdict('fail', 'Session and status endpoints')
        return 1
    check('Graph has indexed nodes and numeric array IDs', lambda: (lambda g: len(g['nodes']) > 0 and all(n['id'] == i for i, n in enumerate(g['nodes'])))(json.loads(request('/api/graph'))))
    check('Chat returns an answer and source indexes', lambda: (lambda r: isinstance(r['answer'], str) and isinstance(r['nodes'], list))(json.loads(request('/chat', {'question': 'What are the payment terms?'}))))
    marker = 'preflight' + uuid.uuid4().hex[:12]
    def remember_chain():
        capture = json.loads(request('/remember', {'text': f'{marker} confirms recall persists as markdown.'}))
        answer = json.loads(request('/chat', {'question': marker}))
        return bool(set(capture['nodes']) & set(answer['nodes']))
    check('Real capture is immediately retrievable (kept as a dated preflight note)', remember_chain)
    def private():
        for route in ('/config.json', '/%2e%2e/config.json', '/server.py', '/data/focus-ledger.jsonl'):
            try:
                request(route)
                return False
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    return False
                error.close()
        return True
    check('Configuration, backend and ledger cannot be served', private)
    for name in ('index.html', 'app.js', 'style.css'):
        check(f'Served {name} matches disk', lambda name=name: hashlib.sha256(request('/' + name)).digest() == hashlib.sha256((Path(__file__).parent / 'viewer' / name).read_bytes()).digest())
    check('Running focus tick thread and diagnostics respond', lambda: json.loads(request('/focus/diag'))['tick_thread_alive'] is True)
    check('Small talk has no source camera movement', lambda: json.loads(request('/chat', {'question': 'Good morning'}))['nodes'] == [])
    if live:
        check('Real provider key and exact configured model minimal call', lambda: status['provider'] != 'offline' and json.loads(request('/models/verify', {'name': status['model']}))['verified'])
        if jpeg:
            import base64
            image = 'data:image/jpeg;base64,' + base64.b64encode(Path(jpeg).read_bytes()).decode()
            check('Real JPEG vision response', lambda: bool(json.loads(request('/see', {'source': 'screen', 'consent': True, 'image': image, 'question': 'Describe this test image briefly.'}))['answer']))
        else:
            verdict('fail', 'Real JPEG vision requires --jpeg path to an intentionally shared test image')
    else:
        verdict('warn', 'Cloud key/model access and real vision untested. Run --live --jpeg only after configuring consent and costs.')
    print(f"{counts['pass']} pass, {counts['fail']} fail, {counts['warn']} warn")
    return 1 if counts['fail'] else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:4700')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--jpeg')
    args = parser.parse_args()
    sys.exit(run(args.url.rstrip('/'), args.live, args.jpeg))
