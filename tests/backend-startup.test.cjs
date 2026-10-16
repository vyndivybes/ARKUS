'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {createBackendDiagnostics} = require('../desktop/backend-diagnostics.cjs');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkus-startup-'));
  t.after(() => fs.rmSync(dataDir, {recursive: true, force: true}));
  const backend = new EventEmitter();
  backend.stderr = new EventEmitter();
  backend.exitCode = null;
  backend.signalCode = null;
  return {dataDir, backend};
}

test('a premature backend exit records the Python traceback and identifies its exit code', t => {
  const {dataDir, backend} = fixture(t);
  const diagnostics = createBackendDiagnostics(backend, dataDir);
  backend.stderr.emit('data', Buffer.from('Traceback (most recent call last):\nValueError: invalid config\n'));
  backend.exitCode = 7;
  backend.emit('close', 7, null);
  assert.equal(diagnostics.hasFailed(), true);
  assert.match(diagnostics.failureMessage(), /exited with code 7/i);
  assert.match(fs.readFileSync(diagnostics.logPath, 'utf8'), /ValueError: invalid config/);
});

test('startup error dialogs never expose raw traceback or secrets', t => {
  const {dataDir, backend} = fixture(t);
  const diagnostics = createBackendDiagnostics(backend, dataDir);
  backend.stderr.emit('data', Buffer.from('api_key=private-test-key\n'));
  backend.exitCode = 1;
  backend.emit('close', 1, null);
  assert.doesNotMatch(diagnostics.failureMessage(), /private-test-key|api_key/);
  assert.match(diagnostics.failureMessage(), /backend-startup\.log/);
});

test('failed Python spawn is distinguished from Python exiting', t => {
  const {dataDir, backend} = fixture(t);
  const diagnostics = createBackendDiagnostics(backend, dataDir);
  backend.emit('error', Object.assign(new Error('file missing'), {code: 'ENOENT'}));
  assert.equal(diagnostics.hasFailed(), true);
  assert.match(diagnostics.failureMessage(), /could not be launched/i);
  assert.match(diagnostics.failureMessage(), /ENOENT/);
});

test('diagnostic output is bounded and clears any stale previous launch log', t => {
  const {dataDir, backend} = fixture(t);
  const filename = path.join(dataDir, 'backend-startup.log');
  fs.writeFileSync(filename, 'stale secret from previous launch');
  const diagnostics = createBackendDiagnostics(backend, dataDir);
  backend.stderr.emit('data', Buffer.from('x'.repeat(100000)));
  backend.exitCode = 2;
  backend.emit('close', 2, null);
  const saved = fs.readFileSync(filename, 'utf8');
  assert.ok(saved.length < 34000, 'startup log must stay bounded');
  assert.ok(!saved.includes('stale secret'), 'a new launch replaces old diagnostics');
  assert.equal(diagnostics.hasFailed(), true);
});
