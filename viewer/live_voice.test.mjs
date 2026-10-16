import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_ENDPOINT,liveUrl,setupMessage,floatToPcm16,pcm16ToFloat,parseLiveMessage,createLiveVoice} from './live_voice.js';

test('only constrained Live WebSocket endpoint receives the ephemeral token',()=>{
  assert.match(liveUrl('auth_tokens/abc1234'),/BidiGenerateContentConstrained\?access_token=auth_tokens%2Fabc1234$/);
  assert.ok(!LIVE_ENDPOINT.includes('key='));
  assert.throws(()=>liveUrl('a'));
});
test('setup binds exact model and speech-only modalities with no executable tools',()=>{
  const setup=setupMessage('gemini-3.1-flash-live-preview').setup;
  assert.equal(setup.model,'models/gemini-3.1-flash-live-preview');
  assert.deepEqual(setup.generationConfig.responseModalities,['AUDIO']);
  assert.equal(setup.tools,undefined);
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
  assert.equal(parseLiveMessage({toolCall:{functionCalls:[]}}).type,'tool_refused');
  assert.equal(parseLiveMessage({setupComplete:{}}).type,'ready');
});
test('a stopped voice controller never creates or persists credentials',()=>{
  let result='';
  const controller=createLiveVoice({getToken:async()=>{throw Error('must not be called');},onState:v=>result=v});
  assert.equal(controller.active,false);
  controller.stop();
  assert.equal(result,'Off');
});
