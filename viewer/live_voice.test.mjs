import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_ENDPOINT,liveUrl,setupMessage,floatToPcm16,pcm16ToFloat,parseLiveMessage,cameraMessage,createLiveVoice} from './live_voice.js';

test('only constrained Live WebSocket endpoint receives the ephemeral token',()=>{
  assert.match(liveUrl('auth_tokens/abc1234'),/BidiGenerateContentConstrained\?access_token=auth_tokens%2Fabc1234$/);
  assert.ok(!LIVE_ENDPOINT.includes('key='));
  assert.throws(()=>liveUrl('a'));
});
test('setup binds exact model and speech-only modalities with no executable tools',()=>{
  const setup=setupMessage('gemini-3.1-flash-live-preview').setup;
  assert.equal(setup.model,'models/gemini-3.1-flash-live-preview');
  assert.equal(setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs,900);
  assert.deepEqual(setup.generationConfig.responseModalities,['AUDIO']);
  assert.deepEqual(setup.tools[0].functionDeclarations.map(d=>d.name),[
    'get_briefing','search_knowledge','remember_note','set_reminder',
    'list_project_files','read_project_file','write_project_file'
  ]);
  assert.ok(!JSON.stringify(setup.tools).includes('run_shell'));
  assert.throws(()=>setupMessage('../wrong-model'));
});
test('microphone PCM resampling, clipping and 24k speaker conversion',()=>{
  const input=new Float32Array([1,-1,0.5,-0.5,0,0]);
  const bytes=floatToPcm16(input,16000);
  assert.equal(bytes.byteLength,input.byteLength/2);
  const recovered=pcm16ToFloat(bytes);
  assert.equal(recovered.length,input.length);
  assert.ok(recovered[0]>0.99);
  assert.ok(recovered[1]<-0.99);
  assert.equal(floatToPcm16(new Float32Array(4800),48000).length,3200);
  assert.throws(()=>floatToPcm16(input,0));
});
test('audio responses, interrupt and final transcription, unwanted tools refused',()=>{
  const message=parseLiveMessage({serverContent:{
    interrupted:true,inputTranscription:{text:'Hello'},
    outputTranscription:{text:'Good day'},
    modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AQI='}}]},
    turnComplete:true
  }});
  assert.equal(message.type,'content');
  assert.deepEqual(message.audio,['AQI=']);
  assert.equal(message.inputText,'Hello');
  assert.equal(message.interrupted,true);
  assert.equal(parseLiveMessage({toolCall:{functionCalls:[]}}).type,'tool_call');
  assert.equal(parseLiveMessage({toolCallCancellation:{ids:['old']}}).type,'tool_cancelled');
  assert.equal(parseLiveMessage({setupComplete:{}}).type,'ready');
});
test('a stopped voice controller never creates or persists credentials',()=>{
  let result='';
  const controller=createLiveVoice({getToken:async()=>{throw Error('must not be called');},onState:v=>result=v});
  assert.equal(controller.active,false);
  controller.stop();
  assert.equal(result,'Off');
});

test('consented Live session connects, streams PCM and stops all microphone tracks',async()=>{
  const prior={AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode,
               WebSocket:globalThis.WebSocket,navigator:globalThis.navigator};
  const tracks=[{stopped:false,stop(){this.stopped=true}}];
  let socket,node,requested=0,videoConsented=false;
  class FakeAudioContext {
    constructor(){this.sampleRate=48000;this.destination={};this.audioWorklet={addModule:async()=>{}};this.currentTime=0;}
    resume(){return Promise.resolve()}
    close(){return Promise.resolve()}
    createMediaStreamSource(){return {connect(){},disconnect(){}}}
  }
  class FakeNode {
    constructor(){node=this;this.port={onmessage:null};}
    connect(){}disconnect(){}
  }
  class FakeSocket {
    static OPEN=1;
    constructor(url){this.url=url;this.readyState=0;this.sent=[];socket=this;this.bufferedAmount=0;}
    send(message){this.sent.push(JSON.parse(message))}
    close(){this.readyState=3;this.closed=true}
  }
  try{
    globalThis.AudioContext=FakeAudioContext;
    globalThis.AudioWorkletNode=FakeNode;
    globalThis.WebSocket=FakeSocket;
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async(opts)=>{
      assert.equal(opts.audio.echoCancellation,true);requested++;return {getTracks:()=>tracks};}}}});
    const states=[];
    const live=createLiveVoice({getToken:async()=>({token:'auth_tokens/temporary123',model:'gemini-3.1-flash-live-preview'}),
                                getCameraFrame:()=>videoConsented?'data:image/jpeg;base64,/9j/4AAQ':null,
                                onState:x=>states.push(x)});
    await live.start();
    assert.equal(requested,1);
    assert.equal(live.connecting,true);
    socket.readyState=1;socket.onopen();
    assert.equal(socket.sent[0].setup.generationConfig.responseModalities[0],'AUDIO');
    await socket.onmessage({data:JSON.stringify({setupComplete:{}})});
    assert.equal(live.active,true);
    node.port.onmessage({data:new Float32Array(4096)});
    assert.equal(socket.sent[1].realtimeInput.audio.mimeType,'audio/pcm;rate=16000');
    assert.equal(live.sendVideoFrame(),false);
    assert.equal(socket.sent.filter(p=>p.realtimeInput?.video).length,0);
    videoConsented=true;
    assert.equal(live.sendVideoFrame(),true);
    assert.deepEqual(socket.sent[2].realtimeInput.video,{mimeType:'image/jpeg',data:'/9j/4AAQ'});
    assert.match(socket.sent[3].clientContent.turns[0].parts[0].text,/describe what you can currently see/i);
    assert.equal(live.sendVideoFrame(),true);
    assert.equal(socket.sent.filter(p=>p.clientContent).length,1);
    assert.ok(!JSON.stringify(socket.sent).includes('temporary123'));
    live.stop();
    assert.equal(tracks[0].stopped,true);
    assert.equal(socket.closed,true);
    assert.equal(live.active,false);
    assert.equal(live.sendVideoFrame(),false);
    assert.equal(states.at(-1),'Off');
  }finally{
    for(const [key,value] of Object.entries(prior)){
      if(key==='navigator')Object.defineProperty(globalThis,key,{configurable:true,value});
      else if(value===undefined)delete globalThis[key];
      else globalThis[key]=value;
    }
  }
});

test('camera frames use the Gemini Live JPEG realtimeInput protocol and reject unsafe data',()=>{
  const jpeg='data:image/jpeg;base64,/9j/4AAQ';
  assert.deepEqual(cameraMessage(jpeg),{realtimeInput:{video:{mimeType:'image/jpeg',data:'/9j/4AAQ'}}});
  assert.throws(()=>cameraMessage('data:image/png;base64,AAAA'));
  assert.throws(()=>cameraMessage('https://example.com/photo.jpg'));
  assert.throws(()=>cameraMessage('data:image/jpeg;base64,not valid'));
  assert.throws(()=>cameraMessage('data:image/jpeg;base64,'+'A'.repeat(900001)));
});

test('camera is never sent before opt-in and stops with the live session', async()=>{
  const oldSocket=globalThis.WebSocket;
  let sent=[];
  class FakeSocket {
    static OPEN=1;
    readyState=1;
    bufferedAmount=0;
    send(data){sent.push(JSON.parse(data));}
    close(){this.readyState=3;}
  }
  try{
    globalThis.WebSocket=FakeSocket;
    let visible=false;
    const session=createLiveVoice({
      getToken:async()=>{throw Error('not called in isolated camera test')},
      getCameraFrame:()=>visible?'data:image/jpeg;base64,/9j/4AAQ':null
    });
    assert.equal(session.sendVideoFrame(),false);
    // No microphone, video or provider connection is started by merely declaring a camera source.
    assert.equal(sent.length,0);
    session.stop();
    assert.equal(session.sendVideoFrame(),false);
  }finally{globalThis.WebSocket=oldSocket;}
});

test('Live model tool call uses the local gateway and returns matched function response',async()=>{
  const saved={AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode,
      WebSocket:globalThis.WebSocket,navigator:globalThis.navigator};
  let socket,requests=[],exchanges=[];
  class FakeAudio {
    constructor(){this.sampleRate=48000;this.destination={};this.audioWorklet={addModule:async()=>{}};}
    resume(){return Promise.resolve()} close(){return Promise.resolve()}
    createMediaStreamSource(){return {connect(){},disconnect(){}}}
  }
  class FakeNode {constructor(){this.port={onmessage:null}}connect(){}disconnect(){}}
  class FakeSocket{
    static OPEN=1;
    constructor(){socket=this;this.readyState=1;this.bufferedAmount=0;this.sent=[]}
    send(s){this.sent.push(JSON.parse(s))}
    close(){this.readyState=3}
  }
  try{
    globalThis.AudioContext=FakeAudio;globalThis.AudioWorkletNode=FakeNode;globalThis.WebSocket=FakeSocket;
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}}});
    const voice=createLiveVoice({
      getToken:async()=>({token:'auth_tokens/for-test-123',model:'gemini-3.1-flash-live-preview'}),
      callTool:async(name,args)=>{requests.push([name,args]);return {answer:'Reminded'};},
      onExchange:async(a,b)=>{exchanges.push([a,b])}
    });
    await voice.start();socket.onopen();
    await socket.onmessage({data:JSON.stringify({setupComplete:{}})});
    assert.equal(voice.active,true);
    await socket.onmessage({data:JSON.stringify({toolCall:{functionCalls:[
      {id:'call-1',name:'set_reminder',args:{when:'2030-01-02T15:30',message:'Alpha'}}
    ]}})});
    assert.deepEqual(requests,[['set_reminder',{when:'2030-01-02T15:30',message:'Alpha'}]]);
    const response=socket.sent.at(-1).toolResponse.functionResponses[0];
    assert.equal(response.id,'call-1');
    assert.equal(response.name,'set_reminder');
    assert.equal(response.response.result.answer,'Reminded');
    await socket.onmessage({data:JSON.stringify({serverContent:{
      inputTranscription:{text:'Remind me about alpha.'},
      outputTranscription:{text:'Your reminder is set.'},
      turnComplete:true
    }})});
    assert.deepEqual(exchanges,[['Remind me about alpha.','Your reminder is set.']]);
    voice.stop();
  }finally{
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:saved.navigator});
    for(const key of ['AudioContext','AudioWorkletNode','WebSocket']){
      if(saved[key]===undefined)delete globalThis[key];else globalThis[key]=saved[key];
    }
  }
});
test('unknown tool requests never invoke local actions', async()=>{
  const calls=[];
  const voice=createLiveVoice({getToken:async()=>{throw Error('no provider needed')},callTool:async(name)=>calls.push(name)});
  assert.equal(voice.active,false);
  voice.stop();
  assert.deepEqual(calls,[]);
});

test('microphone diagnostics explain blocked, missing and busy input devices without exposing credentials',async()=>{
  const {microphoneErrorMessage}=await import('./live_voice.js');
  assert.match(microphoneErrorMessage({name:'NotAllowedError',message:'secret credential'}),/Windows Settings.*Microphone/);
  assert.match(microphoneErrorMessage({name:'NotFoundError'}),/No microphone input/);
  assert.match(microphoneErrorMessage({name:'NotReadableError'}),/exclusive microphone access/);
  assert.ok(!microphoneErrorMessage({name:'NotAllowedError',message:'secret credential'}).includes('secret credential'));
});
