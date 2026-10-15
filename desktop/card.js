'use strict';
let paused = false;
window.arkusDesktop.onFocusState(state => {
  paused = !!state.paused;
  const seconds = Math.max(0, Math.floor(state.remaining || 0));
  document.querySelector('#time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  document.querySelector('#status').textContent = !state.on ? (state.watching ? 'Screen watch active · frame consent in main window' : 'No focus session') : state.deferred ? 'Go to your work; settling…' : paused ? 'Paused' : state.timer_only ? 'Timer only · attention not measured' : state.on_target ? 'On target' : 'Away from target';
  document.body.classList.toggle('drift', !!state.on && !state.timer_only && !state.deferred && !state.on_target && !paused);
  document.querySelector('#pause').textContent = paused ? 'RESUME' : 'PAUSE';
});
for (const id of ['pause', 'abort', 'retarget']) document.getElementById(id).addEventListener('click', async () => {
  try {
    await window.arkusDesktop.focusAction(id === 'pause' && paused ? 'resume' : id);
    document.getElementById('message').textContent = id === 'retarget' ? 'Go to your work; lock waits for two fresh ticks.' : 'Updated';
  } catch { document.getElementById('message').textContent = 'Action failed; check the main window.'; }
});
