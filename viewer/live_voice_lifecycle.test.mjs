import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveVoice} from './live_voice.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
async function harness(run){
  const saved=Object.getOwnPropertyDescriptors(globalThis);
  const sockets=[],streams=[],contexts=[],errors=[],states=[];
  class Audio {
    constructor(){contexts.push(this);this.sampleRate=48000;this.destination={};this.audioWorklet={addModule:async()=>{}};}
    resume(){return Promise.resolve()} close(){this.closed=true;return Promise.resolve()}
    createMediaStreamSource(stream){assert.ok(stream,"microphone stream must still be owned by this session");return {connect(){},disconnect(){}}}
  }
  class Node {constructor(){this.port={}}connect(){}disconnect(){}}
  class Socket {
    static OPEN=1;
    constructor(){sockets.push(this);this.readyState=1;this.bufferedAmount=0;this.sent=[]}
    send(s){this.sent.push(JSON.parse(s))} close(){this.readyState=3}
  }
  let acquire=async()=>newStream();
  function newStream(){const track={stopped:false,stop(){this.stopped=true},addEventListener(type,fn){this[type]=fn}};const stream={getTracks:()=>[track]};streams.push(stream);return stream;}
  globalThis.AudioContext=Audio;globalThis.AudioWorkletNode=Node;globalThis.WebSocket=Socket;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>acquire()}}});
  const voice=createLiveVoice({getToken:async()=>({token:'auth_tokens/test123',model:'gemini-live-test'}),onError:e=>errors.push(e),onState:s=>states.push(s)});
  try{await run({voice,sockets,streams,contexts,errors,states,newStream,setAcquire:fn=>acquire=fn, deferred});}
  finally{voice.stop();for(const key of ['AudioContext','AudioWorkletNode','WebSocket','navigator']){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
}

test('binary WebSocket JSON frames establish Live audio',()=>harness(async({voice,sockets})=>{
  await voice.start();const socket=sockets[0];socket.onopen();
  await socket.onmessage({data:new TextEncoder().encode(JSON.stringify({setupComplete:{}})).buffer});
  assert.equal(voice.active,true);
}));

test('Blob WebSocket JSON frames establish Live audio',()=>harness(async({voice,sockets})=>{
  await voice.start();const socket=sockets[0];socket.onopen();
  await socket.onmessage({data:new Blob([JSON.stringify({setupComplete:{}})])});
  assert.equal(voice.active,true);
}));

test('late microphone permission from a stopped session cannot stop the new session',()=>harness(async({voice,sockets,streams,newStream,setAcquire})=>{
  const old=deferred();setAcquire(()=>old.promise);
  const first=voice.start();await Promise.resolve();await Promise.resolve();
  voice.stop();setAcquire(async()=>newStream());await voice.start();
  const socket=sockets[0];await socket.onmessage({data:JSON.stringify({setupComplete:{}})});
  const late=newStream();old.resolve(late);await first;
  assert.equal(late.getTracks()[0].stopped,true);
  assert.equal(streams[0].getTracks()[0].stopped,false);
  assert.equal(voice.active,true);
}));

test('microphone disconnection ends sharing and releases resources',()=>harness(async({voice,sockets,streams,errors})=>{
  await voice.start();await sockets[0].onmessage({data:JSON.stringify({setupComplete:{}})});
  const track=streams[0].getTracks()[0];assert.equal(typeof track.ended,'function');track.ended();
  assert.equal(voice.active,false);assert.equal(sockets[0].readyState,3);assert.match(errors.at(-1),/microphone/i);
}));

test('provider errors fail closed instead of leaving microphone connecting indefinitely',()=>harness(async({voice,sockets,streams,errors})=>{
  await voice.start();await sockets[0].onmessage({data:JSON.stringify({error:{code:429,message:'PRIVATE_SECRET'}})});
  assert.equal(voice.connecting,false);assert.equal(streams[0].getTracks()[0].stopped,true);
  assert.match(errors.at(-1),/429/);assert.ok(!errors.join('').includes('PRIVATE_SECRET'));
}));

test('late token response cannot release a restarted microphone',()=>harness(async({voice,sockets,streams})=>{
  // Exercise a separate controller to delay only the first token request.
  const token=deferred();let count=0;
  const controller=createLiveVoice({getToken:()=>++count===1?token.promise:Promise.resolve({token:'auth_tokens/test123',model:'gemini-live-test'})});
  try{
    const starting=controller.start();
    for(let i=0;i<5;i++)await Promise.resolve();
    controller.stop();await controller.start();
    await sockets.at(-1).onmessage({data:JSON.stringify({setupComplete:{}})});
    token.resolve({token:'auth_tokens/expired123',model:'gemini-live-test'});await starting;
    assert.equal(controller.active,true);assert.equal(streams.at(-1).getTracks()[0].stopped,false);
  }finally{controller.stop();}
}));

test('connection deadline releases the microphone and allows retry',()=>harness(async({streams})=>{
  const errors=[];
  const controller=createLiveVoice({connectTimeoutMs:10,getToken:()=>new Promise(()=>{}),onError:e=>errors.push(e)});
  try{
    void controller.start();
    await new Promise(r=>setTimeout(r,30));
    assert.equal(controller.connecting,false);assert.equal(streams[0].getTracks()[0].stopped,true);
    assert.match(errors.at(-1),/timed out/i);
  }finally{controller.stop();}
}));

test('oversized binary frames stop the session before JSON parsing',()=>harness(async({voice,sockets,errors})=>{
  await voice.start();await sockets[0].onmessage({data:new ArrayBuffer(1_000_001)});
  assert.equal(voice.connecting,false);assert.match(errors.at(-1),/processed/i);
}));
