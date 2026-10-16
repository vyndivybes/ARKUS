'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, session, screen, desktopCapturer } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const {createResearchWindow}=require('./research-window.cjs');
const {createDraftEditor}=require('./draft-editor.cjs');
const {createBackendDiagnostics}=require('./backend-diagnostics.cjs');
const PORT = Number(process.env.ARKUS_PORT || 4700);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('Invalid ARKUS_PORT');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const desktopToken = crypto.randomBytes(32).toString('hex');
const hashSalt = crypto.randomBytes(32);
let backend, backendDiagnostics, mainWindow, card, sensorProcess, sensorPending, sensorEnabled = false, sensorBusy = false, timer, research;
const root = app.getAppPath();
if (process.env.ARKUS_TEST_DATA_DIR) app.setPath('userData', path.resolve(process.env.ARKUS_TEST_DATA_DIR));
const hash = value => crypto.createHmac('sha256', hashSalt).update(value).digest('hex');
const APP_LABELS = Object.freeze({ chrome: 'Google Chrome', msedge: 'Microsoft Edge', brave: 'Brave', firefox: 'Firefox', notepad: 'Notepad', code: 'Visual Studio Code', winword: 'Microsoft Word', excel: 'Microsoft Excel', powerpnt: 'Microsoft PowerPoint', slack: 'Slack', discord: 'Discord', spotify: 'Spotify', explorer: 'File Explorer', windowsterminal: 'Windows Terminal' });

async function request(route, body, internal = false) {
  const headers = {};
  if (internal) headers['X-Arkus-Desktop-Token'] = desktopToken;
  if (body) {
    headers['Content-Type'] = 'application/json';
    if (!internal) {
      const response = await fetch(`${ORIGIN}/api/session`);
      const data = await response.json();
      headers['X-Arkus-Token'] = data.token;
    }
  }
  const response = await fetch(ORIGIN + route, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3500) });
  if (!response.ok) throw new Error(`ARKUS returned ${response.status}`);
  return response.json();
}
function secureWindow(options) {
  const win = new BrowserWindow({ ...options, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== ORIGIN) event.preventDefault(); });
  return win;
}
function readForeground() {
  return new Promise(resolve => {
    if (!sensorProcess) {
      sensorProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'foreground.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      require('node:readline').createInterface({ input: sensorProcess.stdout }).on('line', line => { const done = sensorPending; sensorPending = null; done?.(line); });
      sensorProcess.on('error', () => { sensorProcess = null; sensorPending?.('{}'); sensorPending = null; });
      sensorProcess.on('exit', () => { sensorProcess = null; sensorPending?.('{}'); sensorPending = null; });
    }
    const timeout = setTimeout(() => { sensorPending = null; sensorProcess?.kill(); resolve({ readable: false, home: false, browser: false, tab_status: 'unavailable' }); }, 15000);
    sensorPending = output => {
      clearTimeout(timeout);
      try {
        const info = JSON.parse(output);
        if (!info.name || !info.pid) throw new Error('Unreadable foreground');
        const ownPids = new Set([process.pid, ...app.getAppMetrics().map(metric => metric.pid)]);
        const name = String(info.name || '').toLowerCase();
        const home = ownPids.has(Number(info.pid));
        const label = APP_LABELS[name] || name.replace(/[^a-z0-9 ._-]/gi, '').slice(0, 60) || 'that app';
        resolve({ app: hash(name), home, browser: ['chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'chromium'].includes(name), readable: true, tab_status: 'unsupported_app_only', ...(home ? {} : { label }) });
      } catch { resolve({ readable: false, home: false, browser: false, tab_status: 'unavailable' }); }
    };
    sensorProcess.stdin.write('tick\n');
  });
}
async function tick() {
  if (sensorBusy) return;
  sensorBusy = true;
  try {
    if (sensorEnabled && process.platform === 'win32') {
      const reading = await readForeground();
      if (sensorEnabled) await request('/internal/sensor', reading, true);
    }
    const state = await request('/focus/state');
    const watch = (await request('/api/status')).watch_active === true;
    if (card && !card.isDestroyed()) {
      card.webContents.send('focus-state', { remaining: state.remaining, on: !!state.on, paused: !!state.paused, deferred: !!state.deferred, on_target: !!state.on_target, watching: watch, timer_only: state.mode === 'timer' });
      if (state.on || watch) card.showInactive(); else card.hide();
    }
  } catch { /* Main viewer diagnostics expose backend/sensor availability. */ }
  finally { sensorBusy = false; }
}
async function waitForBackend() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (backendDiagnostics.hasFailed()) throw new Error(backendDiagnostics.failureMessage());
    try { await request('/api/session'); return; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error('ARKUS could not start its local backend. Check Python 3.11+ and whether the configured port is free.');
}
app.whenReady().then(async () => {
  if (process.platform !== 'win32') throw new Error('This desktop shell currently supports Windows 11 only. Use the browser viewer on other platforms.');
  // Refuse an occupied port: never attach to a different service or reuse another process's session.
  const net = require('node:net');
  await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', () => reject(new Error(`Port ${PORT} is occupied. Close the other ARKUS instance or set ARKUS_PORT.`))); probe.listen(PORT, '127.0.0.1', () => probe.close(resolve)); });
  const embedded = path.join(process.resourcesPath, 'python', 'python.exe');
  const python = process.env.ARKUS_PYTHON || (app.isPackaged && fs.existsSync(embedded) ? embedded : 'python');
  backend = spawn(python, [path.join(root, 'server.py')], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ARKUS_DATA_DIR: app.getPath('userData'), ARKUS_CONFIG: process.env.ARKUS_CONFIG || path.join(app.getPath('userData'), 'config.json'), ARKUS_PORT: String(PORT), ARKUS_DESKTOP_TOKEN: desktopToken } });
  backendDiagnostics = createBackendDiagnostics(backend, app.getPath('userData'));
  await waitForBackend();
  // No persistent media grant: every new request goes through explicit consent.
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    const trusted = mainWindow && contents === mainWindow.webContents && contents.getURL().startsWith(ORIGIN + '/') && details.isMainFrame !== false;
    // This only permits reaching the explicit display chooser below; no source
    // is granted until its user-gesture and display-selection checks pass.
    if (trusted && permission === 'display-capture') return callback(true);
    if (trusted && permission === 'media') {
      const media = (details.mediaTypes || []).join(', ') || 'microphone/camera';
      const result = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['Deny', 'Allow once'], defaultId: 0, cancelId: 0, message: `Allow ARKUS to use ${media}?`, detail: 'Only approve after enabling the matching control. Camera and microphone access can be stopped in the viewer.' });
      callback(result.response === 1);
    } else callback(false);
  });
  // Windows has no Electron system picker. Enumerate names only (zero thumbnails),
  // then require an explicit whole-display selection. Never grant audio or a tab.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const frame = request.frame;
    if (!mainWindow || request.securityOrigin !== ORIGIN || !request.userGesture || !request.videoRequested || !frame || frame !== mainWindow.webContents.mainFrame) return callback(null);
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      if (!sources.length) return callback(null);
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Share a whole screen with ARKUS',
        message: 'Choose the display you want ARKUS to see.',
        detail: 'The entire selected display will be shared, including other applications. Frames remain local until you ask a vision question or enable cloud screen-watch nudges in the viewer. Stop sharing in the viewer at any time. No audio is captured.',
        buttons: ['Cancel', ...sources.map((source, index) => `Share display ${index + 1} (${String(source.name).slice(0, 80)})`)],
        defaultId: 0, cancelId: 0, noLink: true
      });
      if (result.response === 0 || !sources[result.response - 1] || mainWindow.isDestroyed() || frame !== mainWindow.webContents.mainFrame) return callback(null);
      callback({ video: sources[result.response - 1] });
    } catch { callback(null); }
  });
  mainWindow = secureWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 650, show: process.env.ARKUS_TEST_HIDE !== '1', title: 'ARKUS', backgroundColor: '#060812' });
  mainWindow.loadURL(ORIGIN + (process.env.ARKUS_TEST_MUTE === '1' ? '/?mute=1' : '/'));
  research=createResearchWindow(mainWindow);
  ipcMain.handle('research-action',async(event,action,value)=>{
    if(!mainWindow || event.sender!==mainWindow.webContents ||
       event.senderFrame!==mainWindow.webContents.mainFrame ||
       !['open','read','find','search','close','review'].includes(action))throw Error('Untrusted research request');
    return research.perform(action,value);
  });
  const editDraft=createDraftEditor({dataDir:app.getPath('userData')});
  ipcMain.handle('open-project-draft',async(event,project,name)=>{
    if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)
      throw Error('Untrusted draft editor request.');
    const current=await request('/projects');
    if(project!==current.active)throw Error('Project changed. Reopen the selected workspace.');
    await request('/workspace/read',{project,name});
    return editDraft(project,name);
  });
  const area = screen.getPrimaryDisplay().workArea;
  card = secureWindow({ x: area.x + area.width - 345, y: area.y + 16, width: 325, height: 175, frame: false, resizable: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, show: false });
  card.loadFile(path.join(__dirname, 'card.html'));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'ARKUS', submenu: [
    { label: 'Enable foreground app focus sensor (opt in)', type: 'checkbox', checked: false, click: async item => { sensorEnabled = item.checked; if (!sensorEnabled) { sensorProcess?.kill(); try { await request('/internal/sensor', { readable: false, home: false, browser: false, tab_status: 'disabled' }, true); } catch {} } } },
    { label: 'Capabilities and privacy', click: () => dialog.showMessageBox(mainWindow, { message: 'Windows app focus · optional and off at launch', detail: 'Fresh foreground process queries only. No titles, URLs, screenshots or camera frames are read by the desktop sensor. Browser tabs are not visible: Chrome/Edge focus is app-only. The card waits for a new foreground target; it never selects a background window. Windows may cover the card with exclusive fullscreen apps. Screen capture requires your explicit display selection in a separate dialog; no audio is captured. Speech recognition depends on the installed browser/runtime.' }) },
    { type: 'separator' }, { role: 'quit' }
  ] }]));
  ipcMain.handle('focus-action', async (event, action) => {
    if (event.sender !== card.webContents || !['pause', 'resume', 'abort', 'retarget'].includes(action)) throw new Error('Forbidden');
    return request(`/focus/${action}`, { from_card: true });
  });
  timer = setInterval(tick, 1000);
  mainWindow.on('closed', () => {research?.close();app.quit();});
}).catch(error => { dialog.showErrorBox('ARKUS could not start', error.message); app.quit(); });
app.on('before-quit', () => { clearInterval(timer); sensorProcess?.kill(); backend?.kill(); });
app.on('window-all-closed', () => app.quit());
