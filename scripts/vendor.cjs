// Copy only the runtime assets the local server is allowed to serve.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'viewer', 'vendor');
fs.mkdirSync(target, {recursive:true});
for (const [source, destination] of [
  ['three/build/three.module.js','three.module.js'],
  ['three/build/three.core.js','three.core.js'],
  ['three/examples/jsm/controls/OrbitControls.js','OrbitControls.js'],
  ['three/LICENSE','THREE-LICENSE.txt'],
  ['@mediapipe/tasks-vision/vision_bundle.mjs','vision_bundle.mjs'],
  ['@mediapipe/tasks-vision/wasm','wasm']
]) {
  fs.cpSync(path.join(root,'node_modules',source),path.join(target,destination),{recursive:true});
}
console.log('Local Three.js and MediaPipe assets prepared.');
