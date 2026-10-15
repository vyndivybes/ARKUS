import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
// Import pure exports without requiring the app package to use module mode.
const source=await readFile(new URL('./posture.js',import.meta.url),'utf8');
const {calibratePose,classifyPose,POSTURE_SAMPLE_MS}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function pose(){const landmarks=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));for(const [i,x,y] of [[0,.5,.2],[11,.3,.4],[12,.7,.4],[23,.4,.8],[24,.6,.8]])landmarks[i]={x,y,visibility:1};return landmarks;}
test('neutral calibrated pose stays neutral',()=>{const p=pose();assert.deepEqual(classifyPose(p,calibratePose(p)),{present:true,head_down:false,slouched:false});});
test('calibrated head drop is a local heuristic',()=>{const p=pose(),b=calibratePose(p);p[0].y=.35;assert.equal(classifyPose(p,b).head_down,true);});
test('calibrated torso compression flags heuristic slouch',()=>{const p=pose(),b=calibratePose(p);p[23].y=p[24].y=.6;assert.equal(classifyPose(p,b).slouched,true);});
test('missing pose emits no head or torso claim',()=>assert.deepEqual(classifyPose(null,calibratePose(pose())),{present:false,head_down:false,slouched:false}));
test('low confidence shoulders prevent calibrated inference',()=>{const p=pose(),b=calibratePose(p);p[11].visibility=.2;assert.equal(classifyPose(p,b).present,false);assert.throws(()=>calibratePose(p));});
test('hips outside camera confidence disable torso lane',()=>{const p=pose();p[23].visibility=p[24].visibility=.1;const b=calibratePose(p);assert.equal(b.torsoRatio,null);const compressed=pose();compressed[23].y=compressed[24].y=.6;assert.equal(classifyPose(compressed,b).slouched,false);});
test('uncalibrated pose cannot claim head down or slouch',()=>assert.deepEqual(classifyPose(pose(),null),{present:true,head_down:false,slouched:false}));
test('payload contains only three booleans',()=>{const payload=classifyPose(pose(),calibratePose(pose()));assert.deepEqual(Object.keys(payload).sort(),['head_down','present','slouched']);assert.ok(Object.values(payload).every(value=>typeof value==='boolean'));});
test('sampling cadence is 250 milliseconds',()=>assert.equal(POSTURE_SAMPLE_MS,250));
