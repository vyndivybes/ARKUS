import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraCapture} from './camera_capture.js';
const stream=()=>{const track={stopped:false,stop(){this.stopped=true},addEventListener(_event,fn){this.ended=fn}};return {getTracks:()=>[track]}};
test('stop during permission prompt releases late camera and never publishes it',async()=>{
 let resolve,shown=[];const capture=createCameraCapture({acquire:()=>new Promise(r=>resolve=r),onStream:s=>shown.push(s)});
 const starting=capture.start();capture.stop();const late=stream();resolve(late);await starting;
 assert.equal(late.getTracks()[0].stopped,true);assert.ok(!shown.includes(late));assert.equal(capture.active,false);
});
test('duplicate starts share one request and device disconnect clears the preview',async()=>{
 let calls=0,shown;const media=stream();const capture=createCameraCapture({acquire:async()=>{calls++;return media},onStream:s=>shown=s});
 await Promise.all([capture.start(),capture.start()]);assert.equal(calls,1);assert.equal(shown,media);
 media.getTracks()[0].ended();assert.equal(shown,null);assert.equal(capture.active,false);capture.stop();
});
test('old permission result cannot replace a newer camera stream',async()=>{
 let resolve,count=0;const late=stream(),fresh=stream();let shown;
 const capture=createCameraCapture({acquire:()=>++count===1?new Promise(r=>resolve=r):Promise.resolve(fresh),onStream:s=>shown=s});
 const first=capture.start();capture.stop();await capture.start();resolve(late);await first;
 assert.equal(shown,fresh);assert.equal(late.getTracks()[0].stopped,true);assert.equal(fresh.getTracks()[0].stopped,false);capture.stop();
});
test('denied permissions report once and allow a fresh request',async()=>{
 let count=0,errors=[];const capture=createCameraCapture({acquire:async()=>{if(++count===1)throw Error('Permission denied');return stream()},onError:e=>errors.push(e)});
 await capture.start();assert.equal(errors.length,1);assert.equal(capture.connecting,false);await capture.start();assert.equal(capture.active,true);capture.stop();
});
