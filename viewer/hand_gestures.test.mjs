import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyHand, HandGestureGate, clampHandPanelPosition, createLocalHandTracking} from './hand_gestures.js';

const p=(x,y)=>({x,y,z:0});
function hand(kind){
  const v=Array.from({length:21},()=>p(.5,.65));
  v[0]=p(.5,.90);v[5]=p(.38,.55);v[9]=p(.48,.50);v[13]=p(.56,.54);v[17]=p(.64,.55);
  if(kind==='open'){
    v[4]=p(.15,.35);v[8]=p(.37,.12);v[12]=p(.48,.10);v[16]=p(.57,.13);v[20]=p(.71,.20);
  }else if(kind==='fist'){
    v[4]=p(.46,.58);v[8]=p(.41,.58);v[12]=p(.49,.55);v[16]=p(.58,.57);v[20]=p(.64,.60);
  }else if(kind==='pinch'){
    v[4]=p(.35,.23);v[8]=p(.36,.23);v[12]=p(.48,.1);v[16]=p(.57,.13);v[20]=p(.71,.20);
  }
  return v;
}
test('MediaPipe hand landmarks classify pinch, fist grab and open-palm release',()=>{
  assert.equal(classifyHand(hand('pinch')).kind,'pinch');
  assert.equal(classifyHand(hand('fist')).kind,'grab');
  assert.equal(classifyHand(hand('open')).kind,'release');
  assert.equal(classifyHand(hand('open').slice(0,4)),null);
  const bad=hand('pinch');bad[8].x=Number.NaN;
  assert.equal(classifyHand(bad),null);
});
test('pinch must be held before one safe selection event and rearmed by release',()=>{
  const gate=new HandGestureGate({holdMs:260,releaseMs:150,lossMs:400});
  const pinch={kind:'pinch',point:{x:.4,y:.2}},open={kind:'release',point:{x:.4,y:.2}};
  assert.equal(gate.accept(pinch,1000),null);
  assert.equal(gate.accept(pinch,1100),null);
  assert.equal(gate.accept(pinch,1270).type,'pinch');
  assert.equal(gate.accept(pinch,1300),null);
  assert.equal(gate.accept(open,1350),null);
  assert.equal(gate.accept(open,1510).type,'release');
  assert.equal(gate.accept(pinch,1600),null);
  assert.equal(gate.accept(pinch,1870).type,'pinch');
});
test('grab moves only after dwell, releases with open palm or hand loss',()=>{
  const gate=new HandGestureGate({holdMs:260,releaseMs:150,lossMs:400});
  const fist=(x,y)=>({kind:'grab',point:{x,y}});
  assert.equal(gate.accept(fist(.4,.3),0),null);
  assert.equal(gate.accept(fist(.4,.3),270).type,'grab');
  assert.deepEqual(gate.accept(fist(.6,.4),300),{type:'move',point:{x:.6,y:.4}});
  assert.equal(gate.accept(null,500),null);
  assert.equal(gate.accept(null,701).type,'release');
  assert.equal(gate.accept(fist(.2,.2),720),null);
  assert.equal(gate.accept(fist(.2,.2),990).type,'grab');
});
test('panel relocation is clamped to visible viewport',()=>{
  assert.deepEqual(clampHandPanelPosition(900,-100,{width:1200,height:800},{width:300,height:280}),{left:888,top:12});
  assert.deepEqual(clampHandPanelPosition(-20,780,{width:640,height:480},{width:500,height:400}),{left:12,top:68});
});
test('hand tracker requires only local model and releases detector after stop',async()=>{
  const samples=[],events=[],states=[];
  let detectorClosed=false,drive;
  const video={readyState:3,currentTime:1.0};
  const restore={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
  globalThis.setInterval=(fn)=>{drive=fn;return 123};
  globalThis.clearInterval=()=>{};
  try{
    const controller=await createLocalHandTracking({
      video,onSample:sample=>samples.push(sample),onGesture:e=>events.push(e),
      loadVision:async()=>({
        FilesetResolver:{forVisionTasks:async path=>{assert.equal(path,'/vendor/wasm');return {};}},
        HandLandmarker:{createFromOptions:async(_,opts)=>{
          assert.equal(opts.baseOptions.modelAssetPath,'/models/hand_landmarker.task');
          return {detectForVideo:()=>({landmarks:[hand('pinch')]}),close(){detectorClosed=true}};
        }}
      })
    });
    await drive(); assert.equal(samples.at(-1).kind,'pinch');
    controller.stop();assert.equal(detectorClosed,true);
    const count=samples.length;await drive();assert.equal(samples.length,count);
  }finally{globalThis.setInterval=restore.setInterval;globalThis.clearInterval=restore.clearInterval;}
});
