'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_STDERR_BYTES = 32 * 1024;

/**
 * Retain only bounded Python stderr in the user's private application-data folder.
 * Never echo stderr to the UI: exceptions can contain file paths or credentials.
 */
function createBackendDiagnostics(backend, dataDir) {
  const logPath = path.join(dataDir, 'backend-startup.log');
  let stderr = Buffer.alloc(0);
  let spawnError = null;
  let closed = null;
  let logAvailable = false;

  function save() {
    const status = spawnError ? `launch error: ${String(spawnError.code || 'unknown').slice(0, 32)}`
      : closed ? `closed: code=${closed.code === null ? 'none' : closed.code}, signal=${closed.signal || 'none'}`
      : 'launching';
    const header = Buffer.from(`ARKUS local backend startup diagnostics\nStatus: ${status}\n\n`);
    try {
      fs.mkdirSync(dataDir, {recursive: true});
      fs.writeFileSync(logPath, Buffer.concat([header, stderr]), {mode: 0o600});
      logAvailable = true;
    } catch {
      // A read-only user directory should not prevent a separate startup error.
      logAvailable = false;
    }
  }

  save(); // Overwrite stale diagnostic output from earlier launches.
  backend.stderr?.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stderr = Buffer.concat([stderr, bytes]).subarray(-MAX_STDERR_BYTES);
    save();
  });
  backend.on('error', error => {
    spawnError = error;
    save();
  });
  backend.on('close', (code, signal) => {
    closed = {code, signal};
    save();
  });

  return {
    logPath,
    hasFailed() {
      return Boolean(spawnError || closed || backend.exitCode !== null || backend.signalCode !== null);
    },
    failureMessage() {
      let reason;
      if (spawnError) {
        const code = String(spawnError.code || 'unknown').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        reason = `Python backend could not be launched (${code}). Check ARKUS_PYTHON or the bundled runtime.`;
      } else {
        const code = closed?.code ?? backend.exitCode;
        const signal = closed?.signal ?? backend.signalCode;
        reason = code !== null && code !== undefined
          ? `Python backend exited with code ${code} before ARKUS was ready.`
          : `Python backend stopped before ARKUS was ready (signal ${signal || 'unknown'}).`;
      }
      return `${reason}\n\n${logAvailable ? `Diagnostic log: ${logPath}\nReview and redact the log before sharing it.` : 'Diagnostic log could not be written. Check application-data folder permissions.'}`;
    }
  };
}

module.exports = {createBackendDiagnostics};
