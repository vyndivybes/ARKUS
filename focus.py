"""Server-owned accountability timer. Identities never leave this module.

Windows foreground samples are pushed by the consenting desktop process.
Browser mode is an honest timer, never a pretend active-window detector.
"""
import json
import threading
import time
from datetime import datetime, timezone

TICK_SECONDS = 1
DRIFT_GRACE = .8
SETTLE_TICKS = 2
DEFER_SECONDS = 45
SENSOR_EXPIRY = 3
DEFAULT_CADENCE = 30
RELIEF_SECONDS = 180
POSTURE_SUSTAIN = .7
ABSENCE_GRACE = 12
POSTURE_COOLDOWN = 30
NAME_DISTRACTIONS = True
LEDGER_KEYS = {'timestamp', 'planned_minutes', 'active_minutes', 'on_target_minutes', 'drifts', 'seconds_adrift', 'percent', 'completed'}
POOLS = [
    ['Sir, {label} can wait.', '{label} has impeccable timing. Yours could improve.', 'A brief return from {label}, sir?', 'The work remains admirably patient with {label}.'],
    ['Twice distracted, sir. {label} is developing ambitions.', '{label} appears to have joined the project uninvited.', 'Shall we give the actual work a turn, sir?', '{label} will survive a little neglect.'],
    ['The detours are becoming the project, sir.', '{label} is winning a competition it never entered.', 'A decisive return to work would be refreshing.', 'Sir, the task has filed a missing person report.']
]


class Focus:
    def __init__(self, ledger, clock=time.monotonic):
        self.lock = threading.RLock()
        self.clock = clock
        self.ledger = ledger
        self.on = False
        self.paused = False
        self.deferred = False
        self.planned = self.remaining = self.active = self.adrift = 0
        self.drifts = self.streak = 0
        self.excused = False
        self.sensor = {}
        self.sensor_at = -100
        self.sensor_seq = 0
        self.settle_seq = -1
        self.target = self.candidate = None
        self.settle = 0
        self.tab_target = None
        self.intent = ''
        self.intent_open = False
        self.mode = 'timer'
        self.cadence = DEFAULT_CADENCE
        self.snoozed_until = self.relief_until = 0
        self.drift_since = None
        self.excursion_seconds = 0
        self.last_nag = -100
        self.last = self.clock()
        self.started = self.last
        self.events = []
        self.seq = 0
        self.thread = None
        self.stopping = threading.Event()
        self.report = None
        self.posture = None
        self.posture_at = -100
        self.posture_since = None
        self.posture_last_nudge = -100
        if self.ledger.exists():
            try:
                for line in reversed(self.ledger.read_text(encoding='utf-8').splitlines()):
                    row = json.loads(line)
                    if row.get('completed') is True and row.get('percent', 0) >= 85:
                        self.streak += 1
                    else:
                        break
            except (OSError, ValueError, TypeError):
                self.streak = 0

    def emit(self, text):
        # Ephemeral speech transport only; drained on delivery, expires after 5s.
        self.seq += 1
        self.events.append({'seq': self.seq, 'text': text, '_at': self.clock()})
        self.events = self.events[-4:]

    def drain(self, after=0):
        with self.lock:
            result = [{k: v for k, v in e.items() if k != '_at'} for e in self.events if e['seq'] > after and self.clock() - e['_at'] < 5]
            self.events.clear()
            return {'events': result, 'seq': self.seq}

    def sample(self, sample):
        with self.lock:
            self.sensor = {k: sample[k] for k in ('app', 'browser', 'home', 'host_hash', 'label', 'readable', 'tab_status') if k in sample}
            for key in ('browser', 'home', 'readable'):
                self.sensor[key] = self.sensor.get(key) is True
            if self.sensor.get('tab_status') not in ('unavailable', 'disabled', 'unsupported_app_only', 'ok'):
                self.sensor['tab_status'] = 'unavailable'
            self.sensor_at = self.clock()
            self.sensor_seq += 1

    def sample_posture(self, sample):
        with self.lock:
            if sample.get('enabled') is False:
                self.posture = None
                self.posture_since = None
            else:
                if set(sample) != {'present', 'head_down', 'slouched'} or any(type(v) is not bool for v in sample.values()):
                    raise ValueError('Only posture booleans are accepted.')
                self.posture = sample.copy()
                self.posture_at = self.clock()

    def fresh(self):
        return self.clock() - self.sensor_at < SENSOR_EXPIRY and self.sensor.get('readable') is True

    def state(self):
        with self.lock:
            return dict(on=self.on, paused=self.paused, deferred=self.deferred,
                        remaining=round(self.remaining), planned=round(self.planned),
                        active_seconds=round(self.active), seconds_adrift=round(self.adrift),
                        drifts=self.drifts, on_target=self.is_target(), excused=self.excused,
                        settle_ticks=self.settle, intent_open=self.intent_open,
                        sensor_available=self.fresh(), mode=self.mode, streak=self.streak,
                        posture_available=self.posture is not None and self.clock() - self.posture_at < SENSOR_EXPIRY,
                        report=self.report)

    def diag(self):
        with self.lock:
            return dict(frontmost_readable=self.fresh(), browser=self.sensor.get('browser', False),
                        tab_read_status=self.sensor.get('tab_status', 'unavailable') if self.fresh() else 'unavailable',
                        home=self.sensor.get('home', False), hash_present=bool(self.sensor.get('host_hash')),
                        deferred=self.deferred, settle_ticks=self.settle,
                        app_target=self.target is not None, tab_target=self.tab_target is not None,
                        on_target=self.is_target(), on=self.on,
                        tick_thread_alive=bool(self.thread and self.thread.is_alive()),
                        mode=self.mode)

    def is_target(self):
        if self.mode == 'timer':
            return False  # No observation is not evidence of attention.
        if not self.fresh():
            return False
        if self.sensor.get('home'):
            return True
        return (not self.posture_drift() and self.sensor.get('app') == self.target and
                (self.tab_target is None or self.sensor.get('host_hash') == self.tab_target))

    def posture_drift(self):
        if self.posture is None or self.clock() - self.posture_at >= SENSOR_EXPIRY:
            return False
        return self.posture_since is not None and self.clock() - self.posture_since >= (POSTURE_SUSTAIN if self.posture['present'] else ABSENCE_GRACE)

    def command(self, action, body):
        with self.lock:
            now = self.clock()
            if action == 'start':
                if self.on:
                    raise ValueError('A focus session is already running.')
                duration = float(body.get('duration', 1500))
                if not 10 <= duration <= 14400:
                    raise ValueError('Choose 10 seconds to four hours.')
                self.planned = self.remaining = duration
                self.active = self.adrift = self.drifts = 0
                self.on, self.paused, self.excused = True, False, False
                self.report = None
                self.target = self.tab_target = self.candidate = None
                self.settle = 0
                self.settle_seq = self.sensor_seq
                self.mode = 'app' if self.fresh() else 'timer'
                self.deferred = self.mode == 'app'
                self.intent_open = True
                self.intent = str(body.get('intent', ''))[:180]
                self.started = self.last = now
                self.drift_since = None
                self.excursion_seconds = 0
                self.last_nag = -100
                self.snoozed_until = self.relief_until = 0
                self.emit("Go to what you're working on and I'll lock on there. What are we focusing on?" if self.deferred else 'Timer started, sir. App and tab tracking are unavailable. What are we focusing on?')
            elif action == 'relief':
                self.relief_until = now + RELIEF_SECONDS
                self.emit('Three quiet minutes, sir.')
            elif not self.on:
                raise ValueError('Start a focus session first.')
            elif action == 'pause':
                self.paused = True
            elif action == 'resume':
                self.paused = False
                self.last = now
            elif action == 'extend':
                seconds = float(body.get('duration', 300))
                if not 1 <= seconds <= 14400:
                    raise ValueError('Invalid extension.')
                self.remaining += seconds
                self.planned += seconds
            elif action == 'retarget':
                # Always defer from the viewer or overlay. Never select a background window.
                self.target = self.tab_target = self.candidate = None
                self.settle = 0
                self.settle_seq = self.sensor_seq
                self.deferred = self.mode != 'timer'
                self.started = now
                self.forgive()
                self.emit("Go to it, sir. I'll lock on where you land." if self.deferred else 'Retarget needs the desktop foreground sensor, sir.')
            elif action == 'snooze':
                self.snoozed_until = now + min(3600, max(1, float(body.get('duration', 15))))
            elif action == 'cadence':
                self.cadence = min(3600, max(3, float(body.get('duration', 30))))
            elif action == 'excuse':
                self.forgive()
                self.excused = True
            elif action == 'intent':
                self.intent = str(body.get('text', ''))[:180]
                self.intent_open = False
                self.emit('Noted, sir.')
            elif action == 'abort':
                self.finish(False)
            else:
                raise ValueError('Unknown focus action.')
            return self.state()

    def forgive(self):
        if self.drift_since is not None:
            self.adrift = max(0, self.adrift - self.excursion_seconds)
            self.drifts = max(0, self.drifts - 1)
        self.drift_since = None
        self.excursion_seconds = 0

    def finish(self, completed):
        percent = round(100 * max(0, self.active - self.adrift) / self.active, 1) if self.active and self.mode != 'timer' else 0
        record = dict(timestamp=datetime.now(timezone.utc).isoformat(), planned_minutes=round(self.planned / 60, 2),
                      active_minutes=round(self.active / 60, 2), on_target_minutes=round(max(0, self.active - self.adrift) / 60, 2) if self.mode != 'timer' else 0,
                      drifts=self.drifts, seconds_adrift=round(self.adrift, 2), percent=percent, completed=completed)
        assert set(record) == LEDGER_KEYS
        self.ledger.parent.mkdir(parents=True, exist_ok=True)
        with self.ledger.open('a', encoding='utf-8') as f:
            f.write(json.dumps(record) + '\n')
        self.streak = self.streak + 1 if completed and percent >= 85 else 0
        self.report = record
        self.on = self.deferred = False
        self.paused = False
        self.target = self.tab_target = self.candidate = None
        self.intent = ''
        self.intent_open = False
        self.emit(f"Session {'complete' if completed else 'ended'}, sir. {record['on_target_minutes']} observed minutes on target of {record['planned_minutes']} planned, and {self.drifts} drifts." if self.mode != 'timer' else 'Timer session ended, sir. Attention was not measured.')

    def tick(self):
        with self.lock:
            now = self.clock()
            ephemeral_label = self.sensor.pop('label', 'that distraction')
            label = str(ephemeral_label)[:60] if NAME_DISTRACTIONS else 'that distraction'
            self.events = [event for event in self.events if now - event['_at'] < 5]
            elapsed, self.last = max(0, now - self.last), now
            if not self.on or self.paused:
                return
            elapsed = min(elapsed, self.remaining)
            self.remaining -= elapsed
            self.active += elapsed
            if self.posture is not None and now - self.posture_at < SENSOR_EXPIRY:
                flagged = not self.posture['present'] or self.posture['head_down'] or self.posture['slouched']
                if flagged and self.posture_since is None:
                    self.posture_since = now
                elif not flagged:
                    self.posture_since = None
                if self.posture_drift() and now - self.posture_last_nudge >= POSTURE_COOLDOWN and now >= max(self.snoozed_until, self.relief_until):
                    self.emit('A brief posture reset, sir? This is only a camera estimate.' if self.posture['present'] else 'Your chair appears to be working alone, sir.')
                    self.posture_last_nudge = now
            else:
                self.posture_since = None
            if self.deferred:
                if self.fresh() and self.sensor.get('app') and not self.sensor.get('home') and self.sensor_seq != self.settle_seq:
                    self.settle_seq = self.sensor_seq
                    candidate = (self.sensor.get('app'), self.sensor.get('host_hash'))
                    self.settle = self.settle + 1 if candidate == self.candidate else 1
                    self.candidate = candidate
                    if self.settle >= SETTLE_TICKS:
                        self.target, self.tab_target = candidate
                        self.deferred = False
                        self.emit('Locked on, sir.' if self.tab_target else 'App locked, sir. Browser tab tracking is unavailable.')
                elif not self.fresh() or self.sensor.get('home'):
                    self.settle = 0
                    self.candidate = None
                # Never lock ARKUS itself after timeout. An honest unresolved lock is safer.
                if now - self.started >= DEFER_SECONDS and self.target is None:
                    self.mode = 'timer'
                    self.deferred = False
                    self.emit('No work app settled, sir. Continuing as a timer without tracking.')
            if self.mode != 'timer':
                if self.deferred or not self.fresh():
                    self.adrift += elapsed  # Unobserved time cannot count as on target.
                elif self.is_target():
                    self.excused = False
                    self.drift_since = None
                    self.excursion_seconds = 0
                elif not self.excused:
                    self.adrift += elapsed
                    if self.drift_since is None:
                        self.drift_since = now
                        self.drifts += 1
                    self.excursion_seconds += elapsed
                    if now - self.drift_since >= DRIFT_GRACE and now - self.last_nag >= self.cadence and now >= max(self.snoozed_until, self.relief_until):
                        tier = min(2, max(0, self.drifts - 1))
                        self.emit(f"Sir, {label} does not look like '{self.intent[:70]}' to me." if self.drifts == 1 and self.last_nag == -100 and self.intent else POOLS[tier][int(now // self.cadence) % 4].format(label=label))
                        self.last_nag = now
            self.sensor.pop('label', None)
            if self.remaining <= 0:
                self.finish(True)

    def start_thread(self):
        def run():
            while not self.stopping.wait(TICK_SECONDS):
                try:
                    self.tick()
                except OSError:
                    self.on = False
                    self.emit('The session ledger could not be saved. Session stopped, sir.')
        self.thread = threading.Thread(target=run, daemon=True, name='focus-tick')
        self.thread.start()
