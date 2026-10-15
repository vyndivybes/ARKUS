"""Exercise the isolated-world bridge with a mocked Electron transport, no UI consent."""
import shutil
import subprocess
import unittest
from pathlib import Path


@unittest.skipUnless(shutil.which('node'), 'Node is required for the desktop bridge contract')
class DesktopBridgeContract(unittest.TestCase):
    def test_safe_subscription_and_focus_actions(self):
        root = Path(__file__).resolve().parents[1]
        script = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
let api, listener, removed = false, invocation;
const transport = {
 on: (channel, fn) => { assert.equal(channel, 'focus-state'); listener = fn; },
 removeListener: (channel, fn) => { removed = channel === 'focus-state' && fn === listener; },
 invoke: (channel, action) => { invocation = [channel, action]; return Promise.resolve({ok:true}); }
};
vm.runInNewContext(fs.readFileSync('desktop/preload.cjs', 'utf8'), {
 process: {platform:'win32'}, require: name => {
  assert.equal(name,'electron');
  return {contextBridge:{exposeInMainWorld:(name, value) => {assert.equal(name,'arkusDesktop'); api=value;}}, ipcRenderer:transport};
 }
});
let received;
const unsubscribe = api.onFocusState(state => { received = state; });
listener({sender:'PRIVATE_IPC_EVENT'}, {remaining:Infinity,on:true,paused:1,deferred:false,on_target:true,app:'PRIVATE_APP',token:'PRIVATE_KEY'});
assert.equal(received.remaining,0);
assert.equal(received.paused,false);
assert.equal(received.on,true);
assert.deepEqual(Object.keys(received).sort(), ['deferred','on','on_target','paused','remaining','timer_only','watching']);
assert.equal(JSON.stringify(received).includes('PRIVATE'),false);
assert.equal(Object.isFrozen(received),true);
unsubscribe(); assert.equal(removed,true);
api.focusAction('retarget'); assert.deepEqual(invocation,['focus-action','retarget']);
api.focusAction('open-shell').then(() => {throw Error('Unsafe action accepted');}, () => console.log('PASS desktop bridge contract'));
"""
        result = subprocess.run(['node', '-e', script], cwd=root, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('PASS desktop bridge contract', result.stdout)
