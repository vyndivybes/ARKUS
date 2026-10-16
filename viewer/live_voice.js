// Gemini Live direct WebSocket voice via short-lived scoped credentials.
// No permanent Google API key is available to this module.
// All media permissions require the user's explicit activation.
export const LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

export function liveUrl(token){
  if (typeof token !== 'string' || token.length < 8 || token.length > 2048) throw new Error('Invalid ephemeral Live token.');
  return LIVE_ENDPOINT + '?access_token=' + encodeURIComponent(token);
}
export function setupMessage(model){
  if(typeof model !== 'string' || !/^gemini-[A-Za-z0-9_.-]{3,90}$/.test(model))throw new Error('Invalid Live model.');
  return {setup:{
    model:'models/'+model,
    generationConfig:{responseModalities:['AUDIO']},
    systemInstruction:{parts:[{text:'You are ARKUS, a concise and cordial personal assistant. Never claim to have used tools or seen images when none were provided. You have no access to files, browsers, robotic hardware or external accounts in this voice session. Ask before any consequential external action.'}]},
    inputAudioTranscription:{},
    outputAudioTranscription:{}
  }};
}
export function floatToPcm16(samples,inputRate,targetRate=16000){
  if (!Number.isFinite(inputRate)||inputRate<8000||inputRate>192000)throw new Error('Invalid input sample rate.');
  const ratio=inputRate/targetRate, length=Math.floor(samples.length/ratio), bytes=new Uint8Array(length*2);
  const view=new DataView(bytes.buffer);
  for(let i=0;i<length;i++){
    const position=Math.min(samples.length-1,Math.floor(i*ratio));
    const value=Math.max(-1,Math.min(1,Number(samples[position])||0));
    view.setInt16(2*i,value<0?Math.round(value*32768):Math.round(value*32767),true);
  }
  return bytes;
}
export function pcm16ToFloat(data){
  if(!(data instanceof Uint8Array)||data.length%2)throw new Error('Invalid PCM packet.');
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const samples=new Float32Array(data.length/2);
  for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
  return samples;
}
function bytesToBase64(bytes){
  let output='';
  for(let i=0;i<bytes.length;i+=0x6000)output+=String.fromCharCode(...bytes.subarray(i,i+0x6000));
  return btoa(output);
}
function base64ToBytes(input){
  if(typeof input!=='string'||input.length>400000||!/^[A-Za-z0-9+/]*={0,2}$/.test(input))throw new Error('Invalid audio chunk.');
  const raw=atob(input),data=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);
  return data;
}
export function parseLiveMessage(message){
  if(!message||typeof message!=='object')return {type:'invalid'};
  if(message.setupComplete)return {type:'ready'};
  if(message.toolCall)return {type:'tool_refused'};
  if(message.goAway)return {type:'reconnect_required'};
  const c=message.serverContent;
  if(!c)return {type:'other'};
  const audio=(c.modelTurn?.parts||[]).flatMap(p=>p?.inlineData?.mimeType?.startsWith('audio/pcm')&&typeof p.inlineData.data==='string'?[p.inlineData.data]:[]);
  return {type:'content',audio,inputText:c.inputTranscription?.text||'',outputText:c.outputTranscription?.text||'',interrupted:c.interrupted===true,turnComplete:c.turnComplete===true};
}

export function cameraMessage(jpegDataUrl){
  if(typeof jpegDataUrl!=='string' || jpegDataUrl.length>900000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(jpegDataUrl)){
    throw new Error('Camera frame must be a bounded JPEG data URL.');
  }
  const encoded=jpegDataUrl.slice('data:image/jpeg;base64,'.length);
  return {realtimeInput:{video:{mimeType:'image/jpeg',data:encoded}}};
}

export function createLiveVoice({getToken,getCameraFrame=()=>null,onState=()=>{},onTranscript=()=>{},onError=()=>{}}){
  let ws=null,stream=null, micContext=null,micNode=null,micSource=null,outputContext=null,nextTime=0,playing=new Set();
  let pending=false,ready=false,session=0,finalInput='',finalOutput='',seconds=0,videoTimer=null,cameraAnnounced=false;

  const update=value=>onState(value);
  function silence(){
    for(const src of playing){try{src.stop()}catch{}}
    playing.clear();
    nextTime=0;
  }
  function releaseResources(){
    clearInterval(videoTimer);videoTimer=null;
    silence();
    if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
    try{micNode?.disconnect()}catch{}
    try{micSource?.disconnect()}catch{}
    micNode=null;micSource=null;
    const input=micContext;micContext=null;
    const out=outputContext;outputContext=null;
    input?.close().catch(()=>{});
    out?.close().catch(()=>{});
  }
  function stop(){
    session++;pending=false;ready=false;cameraAnnounced=false;
    const socket=ws;ws=null;
    if(socket){try{socket.close(1000,'Stopped locally')}catch{}}
    releaseResources();
    update('Off');
  }
  function playChunk(encoded){
    if(!outputContext)return;
    const samples=pcm16ToFloat(base64ToBytes(encoded));
    if(!samples.length)return;
    // Cap queued playback and avoid indefinite memory growth if network bursts.
    if(playing.size>35){silence();onError('Live audio backlog reset.');}
    const buffer=outputContext.createBuffer(1,samples.length,24000);
    buffer.copyToChannel(samples,0);
    const source=outputContext.createBufferSource();
    source.buffer=buffer;source.connect(outputContext.destination);
    source.onended=()=>playing.delete(source);
    const when=Math.max(outputContext.currentTime+0.025,nextTime);
    nextTime=when+buffer.duration;
    playing.add(source);source.start(when);
  }
  function sendVideoFrame(){
    if(!ready || !ws || ws.readyState!==WebSocket.OPEN || ws.bufferedAmount>512000)return false;
    let jpeg;
    try{jpeg=getCameraFrame();}catch{return false;} // Preview can briefly be unready after camera activation.
    if(!jpeg){cameraAnnounced=false;return false;} // Consent absent, sharing stopped, or preview disabled.
    try{
      ws.send(JSON.stringify(cameraMessage(jpeg)));
      if(!cameraAnnounced){
        cameraAnnounced=true;
        ws.send(JSON.stringify({clientContent:{
          turns:[{role:'user',parts:[{text:'Camera sharing is now enabled. Briefly describe what you can currently see and invite me to ask questions. State any uncertainty.'}]}],
          turnComplete:true
        }}));
      }
      return true;
    }catch(error){onError('Live camera frame could not be shared.');return false;}
  }
  async function enableMic(current){
    micContext=new AudioContext();
    await micContext.audioWorklet.addModule('/live_mic_worklet.js');
    if(session!==current)return;
    micSource=micContext.createMediaStreamSource(stream);
    micNode=new AudioWorkletNode(micContext,'arkus-live-capture');
    micNode.port.onmessage=event=>{
      if(session!==current||!ready||!ws||ws.readyState!==WebSocket.OPEN)return;
      if(ws.bufferedAmount>512000)return; // Backpressure: drop rather than accumulate private audio.
      const packet=event.data;
      if(!(packet instanceof Float32Array))return;
      const pcm=floatToPcm16(packet,micContext.sampleRate);
      if(pcm.length>0)ws.send(JSON.stringify({realtimeInput:{audio:{mimeType:'audio/pcm;rate=16000',data:bytesToBase64(pcm)}}}));
    };
    micSource.connect(micNode);micNode.connect(micContext.destination);
    await micContext.resume();
    update('Listening · interrupt by speaking');
    sendVideoFrame();
    videoTimer=setInterval(sendVideoFrame,1000); // Gemini Live video: <= 1 JPEG frame per second.
  }
  async function start(){
    if(pending||ws) return;
    const current=++session;
    pending=true;ready=false;finalInput='';finalOutput='';seconds=0;
    update('Requesting microphone…');
    try{
      // Media consent before issuing a one-use token avoids consuming unused tokens.
      outputContext=new AudioContext();
      await outputContext.resume();
      stream=await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(session!==current){releaseResources();return;}
      update('Connecting Gemini Live…');
      const credential=await getToken();
      if(session!==current){releaseResources();return;}
      const socket=new WebSocket(liveUrl(credential.token));
      ws=socket;
      socket.onopen=()=>{if(session===current)socket.send(JSON.stringify(setupMessage(credential.model)));};
      socket.onmessage=async event=>{
        if(session!==current)return;
        try{
          if(typeof event.data!=='string'||event.data.length>1_000_000)throw new Error('Oversized Live message.');
          const content=parseLiveMessage(JSON.parse(event.data));
          if(content.type==='ready'){ready=true;pending=false;await enableMic(current);return;}
          if(content.type==='tool_refused'){onError('Voice assistant cannot run tools in Live mode.');return;}
          if(content.type==='reconnect_required'){onError('Live session limit reached; reconnect if needed.');stop();return;}
          if(content.type!=='content')return;
          if(content.interrupted){silence();finalOutput='';update('Listening · interruption received');}
          if(content.inputText)finalInput+=content.inputText;
          if(content.outputText)finalOutput+=content.outputText;
          for(const packet of content.audio)playChunk(packet);
          if(content.turnComplete){
            if(finalInput.trim())onTranscript(finalInput.trim(),'user');
            if(finalOutput.trim())onTranscript(finalOutput.trim(),'assistant');
            finalInput='';finalOutput='';update('Listening · interrupt by speaking');
          }
        }catch(error){onError('Live audio message could not be processed.');stop();}
      };
      socket.onerror=()=>{if(session===current)onError('Gemini Live WebSocket failed. Check model access, provider quota and network.');};
      socket.onclose=()=>{if(session===current){onError('Live connection ended.');stop();}};
    }catch(error){
      if(session===current){onError(error?.message||'Live microphone unavailable.');stop();}
    }
  }
  return {start,stop,sendVideoFrame,get active(){return ready},get connecting(){return pending}};
}
