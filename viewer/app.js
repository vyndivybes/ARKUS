// One finish window for the full spoken thought; no organ starts this microphone.
export const FINISH_MS = 900;
export const WATCH_SAMPLE_MS = 5000;
export const WATCH_STILL_MS = 60000;
export const WATCH_COOLDOWN_MS = 180000;
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MUTED = params.get('mute') === '1';
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
let token, graph = {nodes: [], links: []}, sceneView, busy = false, interacted = false;
let screenStream, cameraStream, watchTimer, previousPixels, stillSince = 0, lastNudge = 0, lastDiff = null;
let postureController, postureGeneration=0, postureStarting=false;
let postureWrites=Promise.resolve();
let focusState = {}, eventSequence = 0, reliefUntil = 0, recognizer, listening = false, speechBuffer = '', finishTimer, toastTimer;
const colors = ['#75e9cc','#e7b16d','#7b9eea','#b690dc','#81c5e3','#d388ab','#b1c788'];
const groupColors = new Map();
const colorFor = group => {if(!groupColors.has(group)) groupColors.set(group, colors[groupColors.size % colors.length]); return groupColors.get(group);};

export function sourceDecision(kind, ids) {
  if (kind === 'smalltalk' || kind === 'small_talk' || kind === 'social' || !Array.isArray(ids) || !ids.length) return 'hold';
  return ids.length >= 4 ? 'cluster' : 'fly';
}
export function pixelDifference(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let total=0; for(let i=0;i<a.length;i+=4) total += Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
  return total / ((a.length/4)*3*255);
}
export function watchEligible({monitor, consent, stillMs, cooldownMs, active}) {
  return Boolean(active && monitor && consent && stillMs >= WATCH_STILL_MS && cooldownMs >= WATCH_COOLDOWN_MS);
}
export function isRetarget(text) { return /(?:lock (?:on )?(?:this|the current) (?:tab|app|window)|keep me in this tab|this is the tab|stay on this tab)/i.test(text); }
export function spokenDuration(text, fallback=1500){
  const numberWords={one:1,two:2,three:3,four:4,five:5,ten:10,fifteen:15,twenty:20,'twenty five':25,'twenty-five':25,thirty:30,forty:40,'forty five':45,'forty-five':45,sixty:60};
  const match=text.toLowerCase().match(/(\d+(?:\.\d+)?|twenty[ -]five|forty[ -]five|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|sixty)\s*(seconds?|minutes?|hours?)/);
  if(!match)return fallback;const value=Number(match[1]) || numberWords[match[1]];return value*(match[2].startsWith('hour')?3600:match[2].startsWith('minute')?60:1);
}
function status(text) { $('activity').textContent=text; }
function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,6500); }
function stopSpeech(){window.speechSynthesis?.cancel();}
function speak(text) {
  // Central privacy guard: every audible path passes here, including focus events.
  if(MUTED || !$('voice').checked || !interacted || !window.speechSynthesis) return;
  stopSpeech(); const utterance=new SpeechSynthesisUtterance(text);
  const voices=speechSynthesis.getVoices(); utterance.voice=voices.find(v=>v.lang==='en-GB') || voices.find(v=>v.lang.startsWith('en')) || null;
  utterance.rate=.98; utterance.onstart=()=>status('Speaking'); utterance.onend=()=>status(listening?'Listening':'Awaiting your next thought');
  speechSynthesis.speak(utterance);
}
async function api(path, body) {
  if(body !== undefined && !token) {const session=await fetch('/api/session',{cache:'no-store'}); if(!session.ok) throw new Error('Local session unavailable.'); token=(await session.json()).token;}
  const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-Arkus-Token':token},body:body===undefined?undefined:JSON.stringify(body)});
  let data; try {data=await response.json();} catch {throw new Error('The server returned an unreadable response.');}
  if(!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}
function addMessage(text, role='assistant', ids=[]) {
  const item=document.createElement('div');item.className=`message ${role}`;
  const who=document.createElement('span');who.className='who';who.textContent=role==='user'?'YOU':role==='error'?'SYSTEM':'ARKUS';
  const p=document.createElement('p');p.textContent=text;item.append(who,p);
  if(ids.length){const links=document.createElement('div');links.className='source-links';for(const id of ids){const node=graph.nodes.find(n=>n.id===id);if(!node)continue;const b=document.createElement('button');b.textContent=node.label;b.addEventListener('click',()=>selectSource(node,true));links.append(b);}item.append(links);}
  $('messages').append(item);$('messages').scrollTop=$('messages').scrollHeight;
  while($('messages').children.length>30)$('messages').firstElementChild.remove();
}
function selectSource(node, fly=true){$('source').hidden=false;$('sourceGroup').textContent=`SOURCE · ${node.group || 'NOTES'}`;$('sourceTitle').textContent=node.label;$('sourceText').textContent=node.excerpt || node.content || 'No excerpt available.';sceneView?.select([node.id],fly);}
function showSources(kind, ids){const decision=sourceDecision(kind,ids);if(decision==='hold')return;const valid=ids.filter(id=>graph.nodes.some(n=>n.id===id));sceneView?.select(valid,decision==='fly');if(valid.length && decision==='fly') selectSource(graph.nodes.find(n=>n.id===valid[0]),true);else if(decision==='cluster'){$('source').hidden=true;toast(`${valid.length} sources illuminated. Camera held for the full picture.`);}}
function renderLibrary(){
  $('noteCount').textContent=String(graph.nodes.length).padStart(2,'0');$('nodeMetric').textContent=`${String(graph.nodes.length).padStart(2,'0')} NODES`;$('linkMetric').textContent=`${String(graph.links.length).padStart(2,'0')} CONNECTIONS`;
  const counts=new Map(); graph.nodes.forEach(n=>counts.set(n.group || 'Notes',(counts.get(n.group || 'Notes')||0)+1));
  $('groups').replaceChildren();for(const [name,count] of counts){const item=document.createElement('div');item.className='group';const dot=document.createElement('i');dot.style.background=colorFor(name);const label=document.createElement('span');label.textContent=name;const b=document.createElement('b');b.textContent=String(count).padStart(2,'0');item.append(dot,label,b);$('groups').append(item);}
  renderNotes();
}
function renderNotes(){const q=$('search').value.toLowerCase();$('notes').replaceChildren();for(const node of graph.nodes.filter(n=>`${n.label} ${n.group} ${n.excerpt}`.toLowerCase().includes(q))){const b=document.createElement('button');b.className='note';b.textContent=node.label;b.title=node.label;b.addEventListener('click',()=>selectSource(node));$('notes').append(b);}}
async function refreshGraph(newGraph){graph=newGraph || await api('/api/graph');graph.nodes??=[];graph.links??=[];renderLibrary();sceneView?.update(graph);}
async function command(text){
  if(/^(?:stop|wait)[.!]?$/i.test(text)){stopSpeech();status('Paused speaking');return true;}
  if(isRetarget(text)){await focusAction('retarget',{from_card:false});return true;}
  if(/(?:focus (?:for|on)|start (?:a )?focus|(?:give me |let'?s do )?(?:\d+|thirty|twenty(?:[ -]five)?|fifteen|forty(?:[ -]five)?|sixty) minutes on this)/i.test(text)){await focusAction('start',{duration:spokenDuration(text)});return true;}
  if(/^(?:pause|resume) (?:the |my )?(?:focus|session|timer)[.!]?$/i.test(text)){await focusAction(/^pause/i.test(text)?'pause':'resume');return true;}
  if(/^(?:abort|end|stop|cancel) (?:the |my )?(?:focus|session|timer)[.!]?$/i.test(text)){await focusAction('abort');return true;}
  if(/(?:extend (?:the |my )?(?:focus|session|timer)|add .* minutes?)/i.test(text)){await focusAction('extend',{duration:spokenDuration(text,300)});return true;}
  if(/^(?:snooze\b|give me (?:\d+|fifteen|thirty|twenty) seconds)/i.test(text)){await focusAction('snooze',{duration:spokenDuration(text,15)});return true;}
  if(/(?:callout|call me out|nudge|nag).*(?:every|cadence)/i.test(text)){await focusAction('cadence',{duration:spokenDuration(text,30)});return true;}
  if(/^(?:excuse (?:this|that)|forgive (?:this|that) drift|it'?s okay,? I(?:'m| am) doing research)[.!]?$/i.test(text)){await focusAction('excuse');return true;}
  if(/(?:give me a minute|no (?:jarvis|arkus),? I need to do something important)/i.test(text)){await focusAction('relief');return true;}
  if(/^(?:watch my screen)[.!]?$/i.test(text)){if(!screenStream)await startScreen();$('settings').hidden=false;$('watch').focus();toast('Enable local watch and optional cloud nudges separately in Screen vision.');return true;}
  if(/(?:what do you think of (?:this|my) screen|look at (?:this|my) screen|what do you think of this[?.!]*$)/i.test(text)){await see('screen',text);return true;}
  if(/(?:look at me|what do you think of my shirt)/i.test(text)){await see('camera',text);return true;}
  if(/^(?:switch|swap|change) (?:the )?(?:brain|model) to /i.test(text)){await swapModel(text.replace(/^(?:switch|swap|change) (?:the )?(?:brain|model) to /i,''));return true;}
  if(/^(?:go back to (?:your |the )?)?(?:normal|default) brain[.!]?$/i.test(text)){await swapModel('default');return true;}
  if(focusState.on && focusState.intent_open){await focusAction('intent',{text});return true;}
  return false;
}
async function submit(text){
  text=text.trim();if(!text)return;if(busy){toast('One thought at a time, sir.');return;}
  busy=true;status('Thinking');addMessage(text,'user');
  try{if(await command(text))return;const capture=/^(?:remember that|note to self|don't let me forget|log this)\b[,:]?\s*/i;const remembering=capture.test(text);const result=await api(remembering?'/remember':'/chat',remembering?{text:text.replace(capture,'')}:{question:text});
    if(remembering){await refreshGraph(result.graph);const ids=result.nodes || (result.node?[result.node.id]:[]);const node=graph.nodes.find(n=>n.id===ids[0]);if(node)sceneView?.pulse(node.id);showSources('notes',ids);}
    else showSources(result.kind,result.nodes || []);
    addMessage(result.answer || 'The server returned no answer.','assistant',result.nodes || []);speak(result.answer || 'No answer was returned, sir.');
  }catch(error){addMessage(error.message,'error');speak(error.message);}finally{busy=false;status(listening?'Listening':'Awaiting your next thought');}
}
function setupSpeech(){
  const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Recognition){$('mic').disabled=true;$('mic').title='Speech recognition unavailable in this browser. Typing works.';return;}
  recognizer=new Recognition();recognizer.continuous=true;recognizer.interimResults=true;recognizer.lang='en-GB';
  recognizer.onresult=event=>{clearTimeout(finishTimer);let completed='';for(let i=event.resultIndex;i<event.results.length;i++){const t=event.results[i][0].transcript.trim();if(/^(stop|wait)[.!]?$/i.test(t)){stopSpeech();speechBuffer='';$('question').value='';status('Paused speaking');return;}if(window.speechSynthesis?.speaking)continue;if(event.results[i].isFinal)completed += ` ${t}`;}
    if(completed.trim())speechBuffer=`${speechBuffer} ${completed}`.trim();$('question').value=speechBuffer || event.results[event.results.length-1][0].transcript;
    if(speechBuffer)finishTimer=setTimeout(flushSpeech,FINISH_MS);
  };
  recognizer.onerror=event=>{toast(`Microphone: ${event.error}. Tap the ear to retry.`);stopListening();};
  recognizer.onend=()=>{listening=false;$('mic').classList.remove('active');$('mic').setAttribute('aria-label','Start microphone');status('Microphone off');if(speechBuffer){clearTimeout(finishTimer);finishTimer=setTimeout(flushSpeech,FINISH_MS);}};
  $('mic').addEventListener('click',()=>{if(listening){stopListening();return;}stopSpeech();try{recognizer.start();listening=true;$('mic').classList.add('active');$('mic').setAttribute('aria-label','Stop microphone');status('Listening');}catch(e){toast(e.message);}});
}
function flushSpeech(){const text=speechBuffer;speechBuffer='';$('question').value='';if(text)submit(text);}
function stopListening(){listening=false;speechBuffer='';clearTimeout(finishTimer);recognizer?.stop();$('mic').classList.remove('active');}
async function startScreen(){
  if(!navigator.mediaDevices?.getDisplayMedia){toast('Screen sharing requires a supported browser on localhost or HTTPS.');return;}
  try{const stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'monitor'},audio:false});stopScreen();screenStream=stream;$('screenPreview').srcObject=stream;$('screenPreview').hidden=false;$('stopScreen').disabled=false;$('askScreen').disabled=false;stream.getVideoTracks()[0].addEventListener('ended',stopScreen);const surface=stream.getVideoTracks()[0].getSettings().displaySurface;toast(surface==='monitor'?'Entire monitor shared locally. Frames send only with your consent.':'Single tab or window shared. Local watch requires the entire monitor.');updatePrivacy();}catch(e){toast(`Screen sharing: ${e.message}`);}
}
function stopScreen(){if(watchTimer)api('/watch',{enabled:false}).catch(()=>{});clearInterval(watchTimer);watchTimer=null;screenStream?.getTracks().forEach(t=>t.stop());screenStream=null;previousPixels=null;stillSince=0;$('screenPreview').srcObject=null;$('screenPreview').hidden=true;$('stopScreen').disabled=true;$('askScreen').disabled=true;$('watch').checked=false;$('screenConsent').checked=false;$('watchCloud').checked=false;$('watchStatus').textContent='Screen watch is off. No screen content is sent in chat.';updatePrivacy();}
async function startCamera(){try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera requires localhost or HTTPS.');const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480}},audio:false});stopCamera();cameraStream=stream;$('cameraPreview').srcObject=stream;$('cameraPreview').hidden=false;$('stopCamera').disabled=false;$('askCamera').disabled=false;stream.getVideoTracks()[0].addEventListener('ended',stopCamera);if(!listening){toast('My ears are off, sir — tap the ear button and just talk.');speak('My ears are off, sir — tap the ear button and just talk.');}updatePrivacy();}catch(e){toast(`Camera: ${e.message}`);}}
function stopCamera(){stopPosture();cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;$('cameraPreview').srcObject=null;$('cameraPreview').hidden=true;$('stopCamera').disabled=true;$('askCamera').disabled=true;$('cameraConsent').checked=false;updatePrivacy();}
function stopPosture(message='Posture awareness is off. No frames or landmarks leave your device.'){
  const wasActive=Boolean(postureController || postureStarting);postureGeneration++;postureStarting=false;postureController?.stop();postureController=null;$('postureConsent').checked=false;$('calibratePosture').disabled=true;$('postureStatus').textContent=message;
  if(wasActive){postureWrites=postureWrites.catch(()=>{}).then(()=>api('/focus/posture',{enabled:false}));postureWrites.catch(error=>toast(`Could not clear local posture state: ${error.message}`));}
}
async function enablePosture(){
  if(!$('postureConsent').checked){stopPosture();return;}
  if(!cameraStream){$('postureConsent').checked=false;toast('Enable the local camera preview first, then opt into posture awareness.');return;}
  const generation=++postureGeneration;postureStarting=true;$('postureStatus').textContent='Loading local posture model… No frame will be uploaded.';
  try{
    const {createLocalPosture}=await import('/posture.js');
    if(generation!==postureGeneration)return;
    const controller=await createLocalPosture({video:$('cameraPreview'),onSample:sample=>{postureWrites=postureWrites.catch(()=>{}).then(()=>generation===postureGeneration && $('postureConsent').checked?api('/focus/posture',sample):undefined);return postureWrites;},onStatus:message=>{if(generation===postureGeneration)$('postureStatus').textContent=message;},onError:error=>{if(generation===postureGeneration)stopPosture(`Posture awareness unavailable: ${error.message}`);}});
    if(generation!==postureGeneration){controller.stop();return;}
    postureController=controller;postureStarting=false;$('calibratePosture').disabled=false;$('postureStatus').textContent='Local model ready. Sit comfortably with nose and shoulders visible, then calibrate.';
  }catch(error){if(generation===postureGeneration)stopPosture(`Posture awareness unavailable: ${error.message}. Check local model and runtime assets.`);}
}
function frame(video,width=1280){if(video.readyState<2 || !video.videoWidth)throw new Error('The preview is not ready. Try again in a moment.');const canvas=document.createElement('canvas');canvas.width=Math.min(width,video.videoWidth);canvas.height=Math.round(video.videoHeight*canvas.width/video.videoWidth);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.75);}
async function see(source,question,automatic=false){
  const screen=source==='screen';const consent=screen?(automatic?$('watchCloud').checked:$('screenConsent').checked):$('cameraConsent').checked;
  if(!(screen?screenStream:cameraStream)){toast(`Enable the ${source} preview first.`);$('settings').hidden=false;return;}
  if(!consent){toast(`Explicit ${source} upload consent is required in system controls.`);$('settings').hidden=false;return;}
  if(automatic && (Date.now()<reliefUntil || busy))return;
  status('Looking at one fresh frame');try{const image=frame($(screen?'screenPreview':'cameraPreview'));const result=await api('/see',{consent:true,question:question || $('question').value || (screen?'What do you notice on my screen?':'What do you notice in this camera image?'),image,source});addMessage(result.answer || 'No vision response returned.');speak(result.answer || 'No vision response returned.');}catch(e){addMessage(e.message,'error');}finally{status(listening?'Listening':'Awaiting your next thought');}
}
function startWatch(){
  if(watchTimer)api('/watch',{enabled:false}).catch(()=>{});clearInterval(watchTimer);watchTimer=null;if(!$('watch').checked)return;
  if(!screenStream || screenStream.getVideoTracks()[0].getSettings().displaySurface!=='monitor'){$('watch').checked=false;toast('Screen watch requires the entire monitor. Choose screen and select Entire Screen.');return;}
  api('/watch',{enabled:true}).catch(()=>{});stillSince=Date.now();lastNudge=0;previousPixels=null;$('watchStatus').textContent='Watching for stillness locally. No frames leave unless cloud nudges are separately enabled.';
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;const context=canvas.getContext('2d',{willReadFrequently:true});
  watchTimer=setInterval(async()=>{api('/watch',{enabled:true}).catch(()=>{});if(!screenStream || $('screenPreview').readyState<2)return;context.drawImage($('screenPreview'),0,0,64,36);const pixels=context.getImageData(0,0,64,36).data;lastDiff=pixelDifference(previousPixels,pixels);previousPixels=new Uint8ClampedArray(pixels);if(lastDiff>.018)stillSince=Date.now();const now=Date.now();$('watchStatus').textContent=`Local watch · ${Math.floor((now-stillSince)/1000)}s still · cloud nudges ${$('watchCloud').checked?'enabled':'off'}`;
    if(watchEligible({monitor:true,consent:$('watchCloud').checked,stillMs:now-stillSince,cooldownMs:now-lastNudge,active:!busy && now>=reliefUntil})){lastNudge=now;await see('screen','The screen has been still for a minute. Offer one brief useful nudge based only on visible content; do not infer the user’s emotions or personal traits.',true);}
  },WATCH_SAMPLE_MS);
}
function updatePrivacy(){$('privacyStatus').textContent=screenStream&&cameraStream?'● SCREEN + CAMERA PREVIEW LOCAL':screenStream?'● SCREEN PREVIEW LOCAL':cameraStream?'● CAMERA PREVIEW LOCAL':'● PRIVATE BY DEFAULT';}
async function loadModels(){try{const info=await api('/models');$('models').replaceChildren();for(const model of info.models || []){const option=document.createElement('option');option.value=typeof model==='string'?model:model.id;option.textContent=typeof model==='string'?model:`${model.name || model.id}${model.verified?' · verified':''}`;$('models').append(option);}const state=await api('/api/status');$('brainStatus').textContent=state.provider==='offline'?'OFFLINE · NOTE SEARCH ONLY':state.configured?`${state.provider || 'MODEL'} · CONFIGURED`:'MODEL · SETUP REQUIRED';$('online').classList.toggle('ready',Boolean(state.configured && state.provider!=='offline'));
    $('greeting').textContent=state.provider==='offline'?'ARKUS is ready to search local notes and save thoughts. The 30 starter notes are fictional examples. For an AI conversation, connect a local model such as Ollama. Try “What can you do?”':`ARKUS is connected to ${state.provider}. Ask me a question, search your notes or save a thought. Model access is checked before responding.`;$('modelInfo').textContent=`${state.provider || 'Provider'} · ${state.model || 'No model configured'}. ${state.provider==='offline'?'Free local retrieval; conversational generation and vision require a configured provider.':state.provider==='ollama'?'Local model provider configured; availability must be verified.':state.configured?'Key configured on local server.':'Add your API key to the private local config to use the assistant.'}`;if(state.model)$('models').value=state.model;}catch(e){$('modelInfo').textContent=e.message;}}
async function swapModel(name){try{const result=await api('/model',{name:name || $('models').value});const answer=result.answer || result.message || `Model updated to ${result.model || name}.`;addMessage(answer);speak(answer);await loadModels();}catch(e){toast(e.message);}}
async function focusAction(action,extra={}){try{const body={...extra};if(action==='start'){body.duration=extra.duration ?? Number($('minutes').value)*60;body.intent=$('intent').value;}if(action==='extend')body.duration=extra.duration ?? 300;if(action==='relief'){body.duration=180;reliefUntil=Date.now()+180000;}const result=await api(`/focus/${action}`,body);if(result.answer || result.message){toast(result.answer || result.message);speak(result.answer || result.message);}await refreshFocus();}catch(e){toast(e.message);}}
async function refreshFocus(){try{focusState=await api('/focus/state');if(window.arkusDesktop?.capabilities?.desktop){$('focusBoundary').textContent=focusState.sensor_available?'Windows companion active: foreground app sensing and a desktop countdown card are available. Browser-tab identity is unavailable; this is an app-level voluntary lock.':'Windows companion loaded; foreground app sensor is unavailable or awaiting consent. Focus runs as a voluntary timer until the sensor is ready.';}const remaining=focusState.remaining ?? focusState.remaining_seconds ?? 0;const total=Math.max(0,Math.ceil(remaining));$('timer').textContent=`${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;const active=focusState.on ?? focusState.active;const mode=focusState.paused?'PAUSED':focusState.deferred?'DEFERRED':active?'FOCUSING':'OFF';$('focusBadge').textContent=mode;$('focusStatus').textContent=focusState.deferred?'Deferred lock: waiting for an explicitly observable work target.':focusState.paused?'Session paused.':active?`${focusState.drifts || 0} drifts · ${focusState.on_target?'on target':'target sensing limited or away'}`:'A voluntary focus companion. Always interruptible.';
    if(params.has('focusdebug')){$('debug').hidden=false;$('debug').textContent=JSON.stringify({on:active,paused:focusState.paused,deferred:focusState.deferred,settle_ticks:focusState.settle_ticks,drifts:focusState.drifts,excused:focusState.excused,intent_window:focusState.intent_open,last_pixel_diff:lastDiff,watch_gate:$('watchCloud').checked},null,2);}
    const data=await api(`/focus/events?after=${eventSequence}`);for(const event of data.events || []){eventSequence=Math.max(eventSequence,event.seq || event.sequence || 0);const line=event.message || event.text || event.line;if(line && Date.now()>=reliefUntil){toast(line);speak(line);}}
  }catch{/* Visible diagnostics exposes server availability; polling does not flood chat. */}}
async function diagnostics(){try{$('diagnosticOutput').textContent=JSON.stringify(await api('/focus/diag'),null,2);}catch(e){$('diagnosticOutput').textContent=e.message;}}

async function createGalaxy(){
  try{const THREE=await import('three');const {OrbitControls}=await import('/vendor/OrbitControls.js');
    const canvas=$('galaxy'),renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setClearColor(0x060b10);renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x060b10,.0011);const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,5000);camera.position.set(0,100,730);
    const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.045;controls.minDistance=55;controls.maxDistance=1600;controls.autoRotate=!REDUCED_MOTION;controls.autoRotateSpeed=.12;controls.enablePan=true;
    const group=new THREE.Group();scene.add(group);let meshes=[],lineObjects=[],highlighted=new Set(),flyTarget=null,selectedAt=0;
    const starGeo=new THREE.BufferGeometry();const starPositions=[];const random=(seed)=>{const x=Math.sin(seed*127.1+311.7)*43758.5453;return x-Math.floor(x);};for(let i=0;i<1800;i++){starPositions.push((random(i*3)-.5)*2600,(random(i*3+1)-.5)*1900,(random(i*3+2)-.5)*2200);}starGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0x668b9a,size:1.15,transparent:true,opacity:.6,sizeAttenuation:true})));
    // Orbit rings reinforce depth without replacing the note relationship graph.
    for(let r=0;r<3;r++){const pts=[];for(let j=0;j<=150;j++){const a=j/150*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a)*(230+r*80),Math.sin(a)*50,Math.sin(a)*(230+r*80)));}const ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x35686a,transparent:true,opacity:.10}));ring.rotation.z=.18+r*.18;scene.add(ring);}
    const sphere=new THREE.SphereGeometry(1,16,12);const glowCanvas=document.createElement('canvas');glowCanvas.width=64;glowCanvas.height=64;const ctx=glowCanvas.getContext('2d');const gradient=ctx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(.15,'rgba(255,255,255,.6)');gradient.addColorStop(.45,'rgba(255,255,255,.13)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);const glowTexture=new THREE.CanvasTexture(glowCanvas);
    function update(data){
      meshes.forEach(m=>{group.remove(m);m.material.dispose();if(m.userData.glow){group.remove(m.userData.glow);m.userData.glow.material.dispose();}});lineObjects.forEach(l=>{group.remove(l);l.geometry.dispose();l.material.dispose();});meshes=[];lineObjects=[];
      const groups=[...new Set(data.nodes.map(n=>n.group || 'Notes'))],positions=new Map();
      data.nodes.forEach((n,i)=>{const index=groups.indexOf(n.group || 'Notes');const centerAngle=index/Math.max(1,groups.length)*Math.PI*2;const angle=i*2.399963;const radius=35+Math.sqrt(i%13)*29;let position=new THREE.Vector3(Math.cos(centerAngle)*145+Math.cos(angle)*radius,(random(i+31)-.5)*170,Math.sin(centerAngle)*120+Math.sin(angle)*radius);let birthPosition=null;const old=sceneView?.positions?.get(n.id);if(old)position=old.clone();else if(sceneView?.positions?.size){const related=data.links.find(l=>((l.source?.id??l.source)===n.id && sceneView.positions.has(l.target?.id??l.target)) || ((l.target?.id??l.target)===n.id && sceneView.positions.has(l.source?.id??l.source)));if(related){const neighbor=(related.source?.id??related.source)===n.id?(related.target?.id??related.target):(related.source?.id??related.source);birthPosition=sceneView.positions.get(neighbor).clone();position=birthPosition.clone().add(new THREE.Vector3(24,16,20));}}positions.set(n.id,position);const c=new THREE.Color(colorFor(n.group || 'Notes'));const m=new THREE.Mesh(sphere,new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.95}));m.position.copy(birthPosition && !REDUCED_MOTION?birthPosition:position);m.userData.destination=position;m.scale.setScalar(2.8+(data.links.filter(l=>(l.source?.id??l.source)===n.id || (l.target?.id??l.target)===n.id).length)*.12);m.userData.node=n;const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:c,transparent:true,opacity:.65,depthWrite:false,blending:THREE.AdditiveBlending}));glow.position.copy(m.position);glow.scale.set(36,36,1);m.userData.glow=glow;group.add(m,glow);meshes.push(m);});
      data.links.forEach(l=>{const s=l.source?.id??l.source,t=l.target?.id??l.target;if(!positions.has(s)||!positions.has(t))return;const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([positions.get(s),positions.get(t)]),new THREE.LineBasicMaterial({color:0x69bfb3,transparent:true,opacity:.12}));line.userData={s,t};group.add(line);lineObjects.push(line);});if(sceneView)sceneView.positions=positions;
    }
    function select(ids,fly){highlighted=new Set(ids);for(const link of graph.links){const s=link.source?.id??link.source,t=link.target?.id??link.target;if(ids.includes(s))highlighted.add(t);if(ids.includes(t))highlighted.add(s);}selectedAt=performance.now();controls.autoRotate=false;
      if(fly && ids.length){const m=meshes.find(m=>m.userData.node.id===ids[0]);if(m){const point=m.position.clone();flyTarget={point,camera:point.clone().add(new THREE.Vector3(20,45,155))};}}
    }
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
    canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});canvas.addEventListener('pointerup',e=>{if(!down || Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)return;pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(meshes)[0];if(hit)selectSource(hit.object.userData.node);});
    canvas.addEventListener('pointermove',e=>{pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);raycaster.setFromCamera(pointer,camera);canvas.style.cursor=raycaster.intersectObjects(meshes).length?'pointer':'grab';});
    function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}addEventListener('resize',resize);resize();
    function animate(now){requestAnimationFrame(animate);if(flyTarget){camera.position.lerp(flyTarget.camera,REDUCED_MOTION?1:.045);controls.target.lerp(flyTarget.point,REDUCED_MOTION?1:.045);if(camera.position.distanceTo(flyTarget.camera)<.5)flyTarget=null;}const pulse=REDUCED_MOTION?1:1+Math.sin(now*.002)*.07;meshes.forEach(m=>{m.position.lerp(m.userData.destination,.025);m.userData.glow.position.copy(m.position);const active=highlighted.has(m.userData.node.id);m.material.opacity=highlighted.size?(active?1:.22):.95;m.userData.glow.material.opacity=active?.95:.38;m.userData.glow.scale.setScalar((active?47:29)*pulse);});lineObjects.forEach(l=>{l.material.opacity=highlighted.size?(highlighted.has(l.userData.s)&&highlighted.has(l.userData.t)?.55:.025):.12;});if(highlighted.size && now-selectedAt>25000){highlighted.clear();controls.autoRotate=!REDUCED_MOTION;}controls.update();renderer.render(scene,camera);}
    requestAnimationFrame(animate);sceneView={update,select,positions:new Map(),pulse:id=>{select([id],true);}};update(graph);document.body.dataset.galaxy='ready';
  }catch(error){$('graphFallback').hidden=false;document.body.dataset.galaxy='unavailable';console.warn('Galaxy unavailable:',error.message);}
}
export function runProbe(){const checks=[['finish window is 900ms',FINISH_MS===900],['single source flies',sourceDecision('notes',[1])==='fly'],['four sources hold cluster',sourceDecision('notes',[1,2,3,4])==='cluster'],['small talk holds camera',sourceDecision('smalltalk',[1])==='hold'],['empty sources hold camera',sourceDecision('notes',[])==='hold'],['retarget natural phrase',isRetarget("okay, I'm gonna need you to keep me in this tab")],['pixel equality is still',pixelDifference(new Uint8ClampedArray([1,2,3,255]),new Uint8ClampedArray([1,2,3,255]))===0],['watch cloud requires consent',!watchEligible({monitor:true,consent:false,stillMs:70000,cooldownMs:200000,active:true})],['watch rejects tab capture',!watchEligible({monitor:false,consent:true,stillMs:70000,cooldownMs:200000,active:true})],['watch threshold and cooldown',watchEligible({monitor:true,consent:true,stillMs:60000,cooldownMs:180000,active:true})],['watch cooldown guard',!watchEligible({monitor:true,consent:true,stillMs:70000,cooldownMs:170000,active:true})],['viewport 1440 by 900',innerWidth===1440&&innerHeight===900]];const pass=checks.every(([,ok])=>ok);document.title=`ARKUS PROBE ${pass?'PASS':'FAIL'} ${checks.filter(([,ok])=>ok).length}/${checks.length}`;const pre=document.createElement('pre');pre.id='probeResults';pre.textContent=checks.map(([name,ok])=>`${ok?'PASS':'FAIL'} ${name}`).join('\n');Object.assign(pre.style,{position:'fixed',inset:'100px 20px auto auto',zIndex:100,background:'#07151f',padding:'20px',border:'1px solid #78ddc6'});document.body.append(pre);window.arkusProbe={pass,checks};return {pass,checks};}

document.addEventListener('pointerdown',()=>{if(!interacted){interacted=true;speak($('greeting').textContent);}},{once:true});
$('chatForm').addEventListener('submit',event=>{event.preventDefault();interacted=true;const q=$('question').value;$('question').value='';submit(q);});
$('search').addEventListener('input',renderNotes);$('closeSource').addEventListener('click',()=>$('source').hidden=true);$('settingsToggle').addEventListener('click',()=>$('settings').hidden=!$('settings').hidden);$('closeSettings').addEventListener('click',()=>$('settings').hidden=true);$('voice').checked=!MUTED;$('voice').disabled=MUTED;$('voice').addEventListener('change',()=>{if(!$('voice').checked)stopSpeech();});
$('swapModel').addEventListener('click',()=>swapModel());$('verifyModels').addEventListener('click',async()=>{try{const result=await api('/models/verify',{name:$('models').value});toast(result.answer || result.message || 'Selected model verified.');await loadModels();}catch(e){toast(e.message);}});
$('focusStart').addEventListener('click',()=>focusAction('start'));document.querySelectorAll('[data-focus]').forEach(button=>button.addEventListener('click',()=>focusAction(button.dataset.focus)));$('diagnostics').addEventListener('click',diagnostics);
$('shareScreen').addEventListener('click',startScreen);$('stopScreen').addEventListener('click',stopScreen);$('askScreen').addEventListener('click',()=>see('screen'));$('watch').addEventListener('change',startWatch);$('watchCloud').addEventListener('change',()=>{if($('watchCloud').checked)toast('Cloud nudges enabled for the current share. Fresh screen frames may incur API charges.');});$('startCamera').addEventListener('click',startCamera);$('stopCamera').addEventListener('click',stopCamera);$('askCamera').addEventListener('click',()=>see('camera'));
$('postureConsent').addEventListener('change',enablePosture);$('calibratePosture').addEventListener('click',()=>{try{const result=postureController?.calibrate();if(!result)throw new Error('Enable posture awareness first.');$('postureStatus').textContent=`Calibrated locally. ${result.torsoVisible?'Head and torso heuristics enabled.':'Head heuristic enabled; hips are not confidently visible, so torso detection stays off.'}`;}catch(error){toast(error.message);}});
addEventListener('pagehide',()=>{stopScreen();stopCamera();stopListening();stopSpeech();});
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=> {
  const message=button.dataset.prompt;
  if(message.startsWith('remember that')){$('question').value=message;$('question').focus();return;}
  interacted=true;submit(message);
}));
setupSpeech();
await Promise.allSettled([refreshGraph(),loadModels(),refreshFocus(),diagnostics()]);
// Provider-specific onboarding is set by loadModels(). Never imply a live AI when only note search is available.
await createGalaxy();setInterval(refreshFocus,1000);if(params.has('focusprobe'))runProbe();
