'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('arkusDesktop', Object.freeze({
  capabilities: Object.freeze({ desktop: true, foregroundApp: process.platform === 'win32', browserHost: false, overlay: true }),
  researchAction: (action,value) => {
    if(!['open','read','find','search','close','review'].includes(action))return Promise.reject(new Error('Unsupported research action'));
    if(value!==undefined && (typeof value!=='string'||value.length>1400))return Promise.reject(new Error('Invalid research input'));
    return ipcRenderer.invoke('research-action',action,value);
  },
  openProjectDraft: (project,name) => {
    if(typeof project!=='string'||typeof name!=='string'||project.length>60||name.length>80)
      return Promise.reject(new Error('Invalid project draft.'));
    return ipcRenderer.invoke('open-project-draft',project,name);
  },
  focusAction: action => {
    if (!['pause', 'resume', 'abort', 'retarget'].includes(action)) return Promise.reject(new Error('Unsupported action'));
    return ipcRenderer.invoke('focus-action', action);
  },
  onFocusState: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    // Never expose the Electron event or arbitrary server fields across the bridge.
    const handler = (_event, state) => callback(Object.freeze({
      remaining: Number.isFinite(state?.remaining) ? Math.max(0, state.remaining) : 0,
      on: state?.on === true, paused: state?.paused === true,
      deferred: state?.deferred === true, on_target: state?.on_target === true,
      watching: state?.watching === true, timer_only: state?.timer_only === true
    }));
    ipcRenderer.on('focus-state', handler);
    return () => ipcRenderer.removeListener('focus-state', handler);
  }
}));
