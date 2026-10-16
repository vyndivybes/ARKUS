import {createLiveVoice} from './live_voice.js';
import {classifyGesture,GestureGate} from './gestures.js';
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
let gestureGate=new GestureGate(),gestureIndex=0,cadSelected=null,cadPreviewSession=null;
let postureWrites=Promise.resolve();
let focusState = {}, eventSequence = 0, reliefUntil = 0, recognizer, listening = false, speechBuffer = '', finishTimer, toastTimer, liveVoice;
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
  if(MUTED || !$('voice').checked || !interacted || liveVoice?.active || !window.speechSynthesis) return;
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
function restoreConversation(history=[]){
  const root=$('messages');root.replaceChildren();
  const initial=document.createElement('div');initial.className='message assistant';
  const who=document.createElement('span');who.className='who';who.textContent='ARKUS';
  const p=document.createElement('p');p.id='greeting';p.textContent='Project memory ready. What shall we explore?';
  initial.append(who,p);root.append(initial);
  for(const entry of history.slice(-26)){
    if(entry && ['user','assistant'].includes(entry.role) && typeof entry.content==='string'){
      addMessage(entry.content,entry.role);
    }
  }
}
async function loadProjects(projects){
  projects=projects || await api('/projects');
  const selected=$('activeProject');selected.replaceChildren();
  for(const item of projects.projects || []){
    const option=document.createElement('option');option.value=item.id;option.textContent=item.name;selected.append(option);
  }
  selected.value=projects.active || 'general';
  document.body.dataset.project=selected.value;
  return projects;
}
async function activateProject(path,payload){
  cadPreviewSession?.close();cadPreviewSession=null;$('cadPreviewCanvas').hidden=true;cadSelected=null;
  liveVoice?.stop();
  const result=await api(path,payload);
  $('source').hidden=true;
  if(sceneView)sceneView.positions=new Map();
  await refreshGraph(result.graph);
  await loadProjects(result.projects);
  await refreshWorkflows(false);
  await loadSkills();
  await loadActions();
  await loadCADModels();
  await loadKnowledge();
  restoreConversation(result.history);
  $('search').value='';renderNotes();
  toast('Workspace active: '+$('activeProject').selectedOptions[0]?.textContent);
  status('Project memory ready');
  return result;
}

const announcedDue=new Set();
async function refreshWorkflows(announce=true){
  try{
    const state=await api('/workflow/state');
    if(state.project!==document.body.dataset.project)return;
    const plans=$('workflowPlans');plans.replaceChildren();
    if(!state.plans.length)plans.textContent='No action plans in this project.';
    for(const plan of state.plans.slice(-15).reverse()){
      const card=document.createElement('div');card.className='workflow-card';
      const title=document.createElement('strong');title.textContent=plan.goal;
      const count=plan.steps.filter(step=>step.done).length;
      const meta=document.createElement('p');meta.textContent=`${count}/${plan.steps.length} steps · ${plan.completed?'finished':'in progress'}`;
      card.append(title,meta);
      const next=plan.steps.find(step=>!step.done);
      if(next){
        const row=document.createElement('div');row.className='workflow-step';
        const label=document.createElement('span');label.textContent=next.text;
        const done=document.createElement('button');done.type='button';done.textContent='Confirm done';
        done.addEventListener('click',async()=>{
          if(!window.confirm('Confirm you personally completed: '+next.text+'?'))return;
          try{const result=await api('/workflow/advance',{id:plan.id,confirmed:true});
            toast(result.answer);await refreshWorkflows(false);
          }catch(e){toast(e.message);}
        });row.append(label,done);card.append(row);
      }
      plans.append(card);
    }
    const reminders=$('workflowReminders');reminders.replaceChildren();
    const pending=state.reminders.filter(r=>!r.acknowledged).slice(-12).sort((a,b)=>a.when.localeCompare(b.when));
    if(!pending.length)reminders.textContent='No pending reminders.';
    for(const reminder of pending){
      const item=document.createElement('div');item.className='workflow-card';
      const line=document.createElement('span');line.textContent=`${reminder.when.replace('T',' ')} · ${reminder.message}`;
      const button=document.createElement('button');button.type='button';button.textContent='Acknowledge';
      button.addEventListener('click',async()=>{
        try{await api('/workflow/acknowledge',{id:reminder.id});await refreshWorkflows(false);}
        catch(e){toast(e.message);}
      });item.append(line,button);reminders.append(item);
    }
    if(announce){
      const across=await api('/workflow/due-all');
      for(const due of across.due || []){
        const fingerprint=due.project+':'+due.id;
        if(announcedDue.has(fingerprint))continue;
        announcedDue.add(fingerprint);
        const alertText='Reminder ('+due.project+'): '+due.message;
        toast(alertText);speak(alertText);
        if('Notification' in window && Notification.permission==='granted'){
          try{new Notification('ARKUS project reminder',{body:due.message,tag:'arkus-'+due.id});}catch{/* Notification is optional. */}
        }
      }
    }
  }catch(e){$('workflowPlans').textContent='Local workflows unavailable: '+e.message;}
}
async function loadKnowledge(){
  const root=$('knowledgeFiles');root.replaceChildren();
  try{
    const result=await api('/knowledge/list');
    if(!result.documents.length){root.textContent='No imported documents in this project.';return;}
    for(const doc of result.documents){
      const card=document.createElement('div');card.className='workflow-card';
      const info=document.createElement('span');info.textContent=doc.name+' · '+doc.characters+' characters';
      const del=document.createElement('button');del.className='secondary';del.textContent='Remove';
      del.addEventListener('click',async()=>{
        if(!confirm('Remove indexed document '+doc.name+' from this project?'))return;
        try{await api('/knowledge/remove',{id:doc.id});await loadKnowledge();toast('Document removed from index.');}
        catch(e){toast(e.message);}
      });
      card.append(info,del);root.append(card);
    }
  }catch(e){root.textContent=e.message;}
}
function renderDocumentReferences(documents){
  if(!Array.isArray(documents)||!documents.length)return;
  const target=$('messages').lastElementChild;
  if(!target)return;
  const refs=document.createElement('div');refs.className='source-links';
  for(const doc of documents){
    const b=document.createElement('button');b.textContent='Document: '+doc.title;
    b.title=doc.excerpt;b.addEventListener('click',()=>{
      $('settings').hidden=false;
      $('knowledgeResults').textContent=doc.title+'\n\n'+doc.excerpt;
    });
    refs.append(b);
  }
  target.append(refs);
}
function renderWebReferences(sources){
  if(!Array.isArray(sources)||!sources.length)return;
  const target=$('messages').lastElementChild;
  if(!target)return;
  const refs=document.createElement('div');refs.className='source-links';
  for(const item of sources){
    const link=document.createElement('a');
    link.textContent=item.title+' (source)';
    link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';
    refs.append(link);
  }
  target.append(refs);
}
async function loadMCP(){
  const root=$('mcpServerList');root.replaceChildren();
  try{
    const {servers}=await api('/mcp/servers');
    if(!servers.length){root.textContent='No local MCP endpoints configured.';return;}
    for(const server of servers){
      const card=document.createElement('div');card.className='workflow-card';
      const name=document.createElement('strong');name.textContent=server.name+(server.enabled?' · enabled':' · disabled');card.append(name);
      if(server.enabled){
        const discover=document.createElement('button');discover.textContent='Discover read-only tools';
        discover.addEventListener('click',async()=>{
          try{
            const {tools}=await api('/mcp/discover',{name:server.name});
            if(!tools.length){$('mcpOutput').textContent='No approved read-only tools available.';return;}
            for(const tool of tools){
              const call=document.createElement('button');call.textContent='Request '+tool.name;
              call.addEventListener('click',async()=>{
                try{
                  const argumentsValue=JSON.parse($('mcpArgs').value);
                  if(!argumentsValue||Array.isArray(argumentsValue)||typeof argumentsValue!=='object')throw Error('MCP arguments must be a JSON object.');
                  if(!confirm('Execute local read-only MCP tool '+server.name+'/'+tool.name+' once with the displayed JSON arguments?'))return;
                  const data=await api('/mcp/call',{name:server.name,tool:tool.name,arguments:argumentsValue,approved:true});
                  $('mcpOutput').textContent=JSON.stringify(data,null,2).slice(0,6000);
                }catch(e){$('mcpOutput').textContent=e.message;}
              });card.append(call);
            }
            discover.disabled=true;
          }catch(e){$('mcpOutput').textContent=e.message;}
        });card.append(discover);
      }
      root.append(card);
    }
  }catch(e){root.textContent=e.message;}
}
async function loadCADModels(){
  const host=$('cadModels');host.replaceChildren();
  try{
    const state=await api('/cad/models');
    if(!state.models.length){host.textContent='No parametric assemblies in this project.';return;}
    for(const model of state.models){
      const item=document.createElement('div');item.className='workflow-card';
      const name=document.createElement('strong');name.textContent=model.name+' · revision '+model.revision;
      const load=document.createElement('button');load.type='button';load.textContent='Edit';
      load.addEventListener('click',async()=>{
        try{const value=await api('/cad/get',{id:model.id});
          cadSelected={id:value.id,revision:value.revision};
          $('cadModelName').value=value.name;
          $('cadAssembly').value=JSON.stringify(value.parts,null,2);
          $('cadAssemblyStatus').textContent='Editing '+value.name+' r'+value.revision+'.';
        }catch(e){toast(e.message);}
      });
      item.append(name,load);host.append(item);
    }
  }catch(error){host.textContent=error.message;}
}
function currentCADPart(){
  const shape=$('cadShape').value;
  const dimensions=shape==='box'
    ?{length:Number($('cadLength').value),width:Number($('cadWidth').value),height:Number($('cadHeight').value)}
    :shape==='cylinder'
    ?{radius:Number($('cadRadius').value),height:Number($('cadHeight').value)}
    :{radius:Number($('cadRadius').value),wall:Number($('cadWall').value),height:Number($('cadHeight').value)};
  const position=['cadPosX','cadPosY','cadPosZ'].map(id=>Number($(id).value));
  return {shape,dimensions,position};
}
function CADParts(){
  const parts=JSON.parse($('cadAssembly').value);
  if(!Array.isArray(parts)||!parts.length||parts.length>8)throw new Error('Enter a JSON array of one to eight CAD parts.');
  return parts;
}
function downloadCAD(result){
  const raw=atob(result.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:'model/stl'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=result.name;
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function researchAction(action,value){
  const native=window.arkusDesktop?.researchAction;
  if(typeof native!=='function'){
    $('researchResult').textContent='The separate reference browser requires the Windows ARKUS desktop app.';return;
  }
  if(action==='open'&&!confirm('Open this public HTTPS reference page in a separate isolated window?\n'+value))return;
  try{
    const result=await native(action,value);
    $('researchResult').textContent=result.status==='read'
      ?(result.title+'\n'+result.url+'\n\n'+result.text)
      :JSON.stringify(result,null,2);
  }catch(error){$('researchResult').textContent=error.message;}
}
async function showBriefing(){
  try{const b=await api('/workflow/briefing');addMessage(b.answer,'assistant');speak(b.answer);
  }catch(e){toast(e.message);}
}
async function loadActions(){
  const panel=$('actionList');panel.replaceChildren();
  try{
    const result=await api('/actions');
    const recent=result.actions.slice(-20).reverse();
    if(!recent.length){panel.textContent='No actions in this project.';return;}
    for(const action of recent){
      const card=document.createElement('div');card.className='workflow-card';
      const text=document.createElement('p');
      text.textContent=action.tool+' '+action.arguments.operator+' '+action.arguments.a+', '+action.arguments.b+' · '+action.status+(action.status==='complete'?' = '+action.result:'');
      card.append(text);
      if(action.status==='pending'){
        const approve=document.createElement('button');approve.textContent='Approve once';
        approve.addEventListener('click',async()=>{
          if(!confirm('Run this exact numerical operation once?'))return;
          try{const done=await api('/actions/approve',{id:action.id,approved:true});addMessage('Calculation result: '+done.result);await loadActions();}catch(e){toast(e.message);}
        });
        const cancel=document.createElement('button');cancel.textContent='Reject';cancel.className='secondary';
        cancel.addEventListener('click',async()=>{try{await api('/actions/cancel',{id:action.id});await loadActions();}catch(e){toast(e.message);}});
        card.append(approve,cancel);
      }
      panel.append(card);
    }
  }catch(e){panel.textContent=e.message;}
}
async function loadSkills(){
  const root=$('skillRegistry');root.replaceChildren();
  try{
    const data=await api('/skills');
    if(!data.skills.length){root.textContent='No custom skills in this project.';return;}
    for(const skill of data.skills){
      const card=document.createElement('div');card.className='workflow-card';
      const title=document.createElement('strong');title.textContent=skill.name+' · '+skill.status;
      const desc=document.createElement('p');desc.textContent=skill.description+' ('+skill.operation+' · '+skill.inputs.join(', ')+')';
      card.append(title,desc);
      if(skill.status==='draft'){
        const test=document.createElement('button');test.textContent='Test locally';
        test.addEventListener('click',async()=>{try{const r=await api('/skills/test',{id:skill.id});$('skillResult').textContent=r.tests;await loadSkills();}catch(e){toast(e.message);}});
        card.append(test);
      }else if(skill.status==='tested'){
        const active=document.createElement('button');active.textContent='Activate skill';
        active.addEventListener('click',async()=>{if(!confirm('Activate this tested, arithmetic-only skill?'))return;
          try{await api('/skills/activate',{id:skill.id});await loadSkills();}catch(e){toast(e.message);}});
        card.append(active);
      }else{
        const run=document.createElement('button');run.textContent='Run skill';
        run.addEventListener('click',async()=>{
          const values={};for(const name of skill.inputs){const raw=prompt('Enter numeric '+name+':');if(raw===null)return;values[name]=raw;}
          try{const result=await api('/skills/run',{name:skill.name,parameters:values});
            const message=result.output+': '+result.result;$('skillResult').textContent=message;addMessage(message);speak(message);
          }catch(e){toast(e.message);}
        });card.append(run);
      }
      root.append(card);
    }
  }catch(e){root.textContent=e.message;}
}
async function loadCapabilities(){
  try{const data=await api('/workflow/capabilities');const box=$('capabilityList');box.replaceChildren();
    for(const skill of data.capabilities || []){
      const line=document.createElement('div');line.className='capability-item';
      const name=document.createElement('strong');name.textContent=skill.name;
      const status=document.createElement('small');status.textContent=skill.status.replaceAll('_',' ');
      line.append(name,status);box.append(line);
    }
  }catch(e){$('capabilityList').textContent=e.message;}
}
async function command(text){
  if(/^(?:my |the )?(?:daily |morning )?briefing[.!]?$/i.test(text) ||
     /^(?:give me |show me |what is )(?:my |the )?(?:daily |morning )?briefing[.!]?$/i.test(text)){
    await showBriefing();return true;
  }
  if(/^(?:what can you do|show (?:me )?(?:your )?capabilities)[.!]?$/i.test(text)){
    const data=await api('/workflow/capabilities');
    const active=(data.capabilities||[]).filter(x=>x.status==='available').map(x=>x.name);
    const answer='Available locally: '+active.join(', ')+'. Other integrations remain optional or unavailable.';
    addMessage(answer);speak(answer);return true;
  }
  const reminder=text.match(/^remind me (?:on |at )?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}) (?:to|about) (.+)$/i);
  if(reminder){const result=await api('/workflow/reminder',{when:reminder[1]+'T'+reminder[2],message:reminder[3]});
    toast(result.answer);speak(result.answer);await refreshWorkflows(false);return true;}
  const planRequest=text.match(/^(?:create|make) (?:a )?plan for ([^:]+): (.+)$/i);
  if(planRequest){const steps=planRequest[2].split(';').map(x=>x.trim()).filter(Boolean);
    const result=await api('/workflow/plan',{goal:planRequest[1].trim(),steps});
    toast(result.answer);speak(result.answer);await refreshWorkflows(false);return true;}
  const createProject=text.match(/^create (?:a )?(?:new )?project (?:called|named) (.+?)[.!]?$/i);
  if(createProject){await activateProject('/projects/create',{name:createProject[1].trim()});return true;}
  const switchProject=text.match(/^(?:switch (?:to )?project(?: to)?|open project) (.+?)[.!]?$/i);
  if(switchProject){const name=switchProject[1].trim().toLowerCase();
    const selected=[...$('activeProject').options].find(o=>o.value===name || o.textContent.toLowerCase()===name);
    if(!selected)throw new Error('Project not found. Create it in System controls first.');
    await activateProject('/projects/switch',{project:selected.value});return true;
  }
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
    addMessage(result.answer || 'The server returned no answer.','assistant',result.nodes || []);
    renderDocumentReferences(result.document_sources);
    speak(result.answer || 'No answer was returned, sir.');
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
  $('mic').addEventListener('click',()=>{if(listening){stopListening();return;}if(liveVoice?.active||liveVoice?.connecting)liveVoice.stop();stopSpeech();try{recognizer.start();listening=true;$('mic').classList.add('active');$('mic').setAttribute('aria-label','Stop microphone');status('Listening');}catch(e){toast(e.message);}});
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
  const wasActive=Boolean(postureController || postureStarting);postureGeneration++;postureStarting=false;postureController?.stop();postureController=null;$('postureConsent').checked=false;$('gestureConsent').checked=false;gestureGate=new GestureGate();$('gestureStatus').textContent='Gestures off.';$('calibratePosture').disabled=true;$('postureStatus').textContent=message;
  if(wasActive){postureWrites=postureWrites.catch(()=>{}).then(()=>api('/focus/posture',{enabled:false}));postureWrites.catch(error=>toast(`Could not clear local posture state: ${error.message}`));}
}
async function enablePosture(){
  if(!$('postureConsent').checked&&!$('gestureConsent').checked){stopPosture();return;}
  if(!cameraStream){$('postureConsent').checked=false;$('gestureConsent').checked=false;toast('Enable the local camera preview first, then opt into local awareness or gestures.');return;}
  postureController?.stop();postureController=null;gestureGate=new GestureGate();
  const generation=++postureGeneration;postureStarting=true;$('postureStatus').textContent='Loading local pose model… No frame will be uploaded.';
  try{
    const {createLocalPosture}=await import('/posture.js');
    if(generation!==postureGeneration)return;
    const controller=await createLocalPosture({
      video:$('cameraPreview'),
      onSample:sample=>{
        if(!$('postureConsent').checked)return;
        postureWrites=postureWrites.catch(()=>{}).then(()=>generation===postureGeneration&&$('postureConsent').checked?api('/focus/posture',sample):undefined);
        return postureWrites;
      },
      onLandmarks:landmarks=>{
        if(generation!==postureGeneration||!$('gestureConsent').checked)return;
        const action=gestureGate.accept(classifyGesture(landmarks));
        if(!action)return;
        if(action==='both'){
          $('settings').hidden=!$('settings').hidden;
          $('gestureStatus').textContent='Both arms: settings toggled.';
        }else if(graph.nodes.length){
          gestureIndex=(gestureIndex+(action==='right'?1:-1)+graph.nodes.length)%graph.nodes.length;
          selectSource(graph.nodes[gestureIndex],true);
          $('gestureStatus').textContent=(action==='right'?'Next':'Previous')+' knowledge note selected locally.';
        }
      },
      onStatus:message=>{if(generation===postureGeneration)$('postureStatus').textContent=message;},
      onError:error=>{if(generation===postureGeneration)stopPosture(`Local landmarks unavailable: ${error.message}`);}
    });
    if(generation!==postureGeneration){controller.stop();return;}
    postureController=controller;postureStarting=false;$('calibratePosture').disabled=!$('postureConsent').checked;$('postureStatus').textContent='Local pose model ready.';if($('gestureConsent').checked)$('gestureStatus').textContent='Gesture control active: hold a raised arm for 650 ms. Camera data stays on this device.';
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
async function loadModels(){try{const info=await api('/models');$('models').replaceChildren();for(const model of info.models || []){const option=document.createElement('option');option.value=typeof model==='string'?model:model.id;option.textContent=typeof model==='string'?model:`${model.name || model.id}${model.verified?' · verified':''}`;$('models').append(option);}const state=await api('/api/status');$('brainStatus').textContent=state.configured?`${state.provider || 'MODEL'} · READY`:'LOCAL · KEY REQUIRED';$('online').classList.toggle('ready',Boolean(state.configured));$('modelInfo').textContent=`${state.provider || 'Provider'} · ${state.model || 'No model configured'}. ${state.provider==='offline'?'Free local retrieval; conversational generation and vision require a configured provider.':state.provider==='ollama'?'Local model provider configured; availability must be verified.':state.configured?'Key configured on local server.':'Add your API key to the private local config to use the assistant.'}`;if(state.model)$('models').value=state.model;}catch(e){$('modelInfo').textContent=e.message;}}
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

liveVoice=createLiveVoice({
  getToken:()=>api('/live/token',{}),
  onState:value=>{
    status('Live · '+value);
    const running=value!=='Off';
    $('liveMic').classList.toggle('active',running);
    $('liveMic').setAttribute('aria-label',running?'Stop Gemini Live conversation':'Start Gemini Live conversation');
  },
  onTranscript:(text,role)=>addMessage(text,role),
  onError:message=>toast(message)
});
$('liveMic').addEventListener('click',async()=>{
  if(liveVoice.active||liveVoice.connecting){liveVoice.stop();return;}
  if(MUTED||!$('voice').checked){toast('Live voice requires audio output. Disable mute and enable VOICE.');return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode){
    toast('Gemini Live requires a browser with microphone and AudioWorklet support.');return;
  }
  try{
    const configured=await api('/api/status');
    if(!configured.live_available){
      toast('Set provider=gemini, enable_gemini_live=true and allow_paid_models=true in private ARKUS config. Gemini Live may incur charges.');return;
    }
    stopListening();stopSpeech();interacted=true;
    await liveVoice.start();
  }catch(error){toast(error.message);}
});
document.addEventListener('pointerdown',()=>{if(!interacted){interacted=true;speak($('greeting').textContent);}},{once:true});
$('chatForm').addEventListener('submit',event=>{event.preventDefault();interacted=true;const q=$('question').value;$('question').value='';submit(q);});
$('search').addEventListener('input',renderNotes);$('closeSource').addEventListener('click',()=>$('source').hidden=true);$('settingsToggle').addEventListener('click',()=>$('settings').hidden=!$('settings').hidden);$('closeSettings').addEventListener('click',()=>$('settings').hidden=true);$('voice').checked=!MUTED;$('voice').disabled=MUTED;$('voice').addEventListener('change',()=>{if(!$('voice').checked){stopSpeech();liveVoice?.stop();}});
$('openProject').addEventListener('click',async()=>{try{await activateProject('/projects/switch',{project:$('activeProject').value});}catch(e){toast(e.message);await loadProjects();}});
$('createProject').addEventListener('click',async()=>{
  const name=$('newProject').value.trim();if(!name){toast('Enter a project name.');return;}
  try{await activateProject('/projects/create',{name});$('newProject').value='';}catch(e){toast(e.message);}
});
$('backupProjects').addEventListener('click',async()=>{
  const el=$('backupStatus');
  if(!window.confirm('Create a local backup of notes, project conversations, plans and reminders? API keys will NOT be included.'))return;
  el.textContent='Creating local backup…';
  try{
    const b=await api('/backup/create',{});
    el.textContent=`Backup verified: ${b.files} files at ${b.archive}. API credentials excluded. Store an additional copy outside the laptop.`;
    toast('Backup created on this computer.');
  }catch(e){el.textContent='Backup not completed: '+e.message;toast(e.message);}
});
$('clearProjectChat').addEventListener('click',async()=>{
  if(!window.confirm('Clear stored conversation in this project? Notes will not be changed.'))return;
  try{await api('/history/clear',{});restoreConversation([]);toast('Only this project conversation was cleared.');}catch(e){toast(e.message);}
});

$('createWorkflowPlan').addEventListener('click',async()=>{
  const goal=$('workflowGoal').value.trim();
  const steps=$('workflowSteps').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  try{const result=await api('/workflow/plan',{goal,steps});$('workflowGoal').value='';$('workflowSteps').value='';
    toast(result.answer);await refreshWorkflows(false);}
  catch(e){toast(e.message);}
});
$('createReminder').addEventListener('click',async()=>{
  try{const result=await api('/workflow/reminder',{when:$('reminderWhen').value,message:$('reminderMessage').value});
    $('reminderMessage').value='';toast(result.answer);await refreshWorkflows(false);}
  catch(e){toast(e.message);}
});
$('reminderNotifications').addEventListener('click',async()=>{
  if(!('Notification' in window)){toast('Native browser notifications unavailable. In-app reminders still work.');return;}
  const permission=await Notification.requestPermission();
  toast(permission==='granted'?'Local reminder alerts enabled while ARKUS is open.':'Browser permission not granted; in-app reminders still work.');
});
$('actionRequest').addEventListener('click',async()=>{
  const goal=$('actionGoal').value.trim();
  if(!goal){toast('Describe a calculation.');return;}
  try{await api('/actions/request',{goal});await loadActions();toast('Proposal prepared; approve once to run.');}
  catch(e){toast(e.message);}
});
$('actionPropose').addEventListener('click',async()=>{
  const operator=$('actionOperator').value;
  const a=$('actionA').value,b=$('actionB').value;
  if(!a||!b){toast('Enter both operands.');return;}
  try{await api('/actions/propose',{tool:'calculate',arguments:{operator,a:Number(a),b:Number(b)}});
    await loadActions();toast('Action prepared; approve it explicitly to run.');}
  catch(e){toast(e.message);}
});
$('generateSkill').addEventListener('click',async()=>{
  const goal=$('skillGoal').value.trim();if(!goal){toast('Describe the new calculation skill.');return;}
  try{const draft=await api('/skills/generate',{goal});$('skillResult').textContent='Skill draft '+draft.name+' created. Run its tests before activation.';await loadSkills();}
  catch(e){toast(e.message);}
});
$('createManualSkill').addEventListener('click',async()=>{
  try{const spec=JSON.parse($('manualSkill').value);const draft=await api('/skills/propose',{spec});
    $('manualSkill').value='';$('skillResult').textContent='Draft '+draft.name+' saved. Test before activation.';await loadSkills();}
  catch(e){toast(e.message);}
});
$('dailyBriefing').addEventListener('click',showBriefing);
$('generateCad').addEventListener('click',async()=>{
  try{
    const shape=$('cadShape').value;
    const dims=shape==='box'
      ?{length:$('cadLength').value,width:$('cadWidth').value,height:$('cadHeight').value}
      :shape==='cylinder'
      ?{radius:$('cadRadius').value,height:$('cadHeight').value}
      :{radius:$('cadRadius').value,wall:$('cadWall').value,height:$('cadHeight').value};
    const result=await api('/cad/primitive',{shape,dimensions:dims});
    const raw=atob(result.base64);
    const bytes=Uint8Array.from(raw,character=>character.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:'model/stl'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=result.name;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('cadStatus').textContent=`${result.triangles} mesh triangles exported. Check dimensions and mechanical suitability independently.`;
    toast(result.answer);
  }catch(e){$('cadStatus').textContent=e.message;toast(e.message);}
});
$('swapModel').addEventListener('click',()=>swapModel());$('verifyModels').addEventListener('click',async()=>{try{const result=await api('/models/verify',{name:$('models').value});toast(result.answer || result.message || 'Selected model verified.');await loadModels();}catch(e){toast(e.message);}});
$('focusStart').addEventListener('click',()=>focusAction('start'));document.querySelectorAll('[data-focus]').forEach(button=>button.addEventListener('click',()=>focusAction(button.dataset.focus)));$('diagnostics').addEventListener('click',diagnostics);
$('shareScreen').addEventListener('click',startScreen);$('stopScreen').addEventListener('click',stopScreen);$('askScreen').addEventListener('click',()=>see('screen'));$('watch').addEventListener('change',startWatch);$('watchCloud').addEventListener('change',()=>{if($('watchCloud').checked)toast('Cloud nudges enabled for the current share. Fresh screen frames may incur API charges.');});$('startCamera').addEventListener('click',startCamera);$('stopCamera').addEventListener('click',stopCamera);$('askCamera').addEventListener('click',()=>see('camera'));
$('postureConsent').addEventListener('change',enablePosture);$('gestureConsent').addEventListener('change',enablePosture);$('calibratePosture').addEventListener('click',()=>{try{const result=postureController?.calibrate();if(!result)throw new Error('Enable posture awareness first.');$('postureStatus').textContent=`Calibrated locally. ${result.torsoVisible?'Head and torso heuristics enabled.':'Head heuristic enabled; hips are not confidently visible, so torso detection stays off.'}`;}catch(error){toast(error.message);}});
$('researchOpen').addEventListener('click',()=>researchAction('open',$('researchUrl').value.trim()));
$('researchSearch').addEventListener('click',()=>researchAction('search',$('researchTopic').value.trim()));
$('researchRead').addEventListener('click',()=>researchAction('read'));
$('researchFind').addEventListener('click',()=>researchAction('find',$('researchQuery').value));
$('researchClose').addEventListener('click',()=>researchAction('close'));
$('cadAddPart').addEventListener('click',()=>{
  try{const existing=$('cadAssembly').value.trim()?CADParts():[];
    if(existing.length>=8)throw new Error('Eight-part assembly limit reached.');
    existing.push(currentCADPart());$('cadAssembly').value=JSON.stringify(existing,null,2);
    $('cadAssemblyStatus').textContent=existing.length+' part(s) in editor.';
  }catch(error){toast(error.message);}
});
$('cadPreviewButton').addEventListener('click',async()=>{
  try{
    cadPreviewSession?.close();cadPreviewSession=null;
    const canvas=$('cadPreviewCanvas');canvas.hidden=false;
    const {drawCADPreview}=await import('/cad_preview.js');
    cadPreviewSession=await drawCADPreview(canvas,CADParts());
    $('cadAssemblyStatus').textContent='Local 3D preview active. Drag to rotate, scroll to zoom. Separate meshes, not Boolean solids.';
  }catch(error){$('cadPreviewCanvas').hidden=true;toast('CAD preview: '+error.message);}
});
$('cadCreate').addEventListener('click',async()=>{
  try{const model=await api('/cad/create',{name:$('cadModelName').value.trim(),parts:CADParts()});
    cadSelected={id:model.id,revision:model.revision};
    $('cadAssemblyStatus').textContent='Saved '+model.name+' revision '+model.revision+'.';
    await loadCADModels();
  }catch(error){toast(error.message);}
});
$('cadRevise').addEventListener('click',async()=>{
  if(!cadSelected){toast('Select Edit on an existing model first.');return;}
  try{const model=await api('/cad/revise',{id:cadSelected.id,revision:cadSelected.revision,parts:CADParts()});
    cadSelected.revision=model.revision;
    $('cadAssemblyStatus').textContent='Saved revision '+model.revision+'.';
    await loadCADModels();
  }catch(error){toast(error.message);}
});
$('cadExport').addEventListener('click',async()=>{
  if(!cadSelected){toast('Select or create a model first.');return;}
  try{const result=await api('/cad/export',{id:cadSelected.id});downloadCAD(result);
    $('cadAssemblyStatus').textContent=result.triangles+' triangles in STL · revision '+result.revision+'.';
  }catch(error){toast(error.message);}
});
$('knowledgeImport').addEventListener('click',async()=>{
  const file=$('knowledgeFile').files?.[0];
  if(!file){toast('Select a TXT, Markdown, DOCX or supported text PDF.');return;}
  if(!file.size||file.size>2_000_000){toast('Document must be smaller than 2 MB.');return;}
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());let raw='';
    for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const result=await api('/knowledge/import',{name:file.name,data:btoa(raw)});
    toast('Indexed '+result.name+' in '+result.chunks+' passage(s).');
    $('knowledgeFile').value='';await loadKnowledge();
  }catch(e){toast('Import failed: '+e.message);}
});
$('knowledgeSearch').addEventListener('click',async()=>{
  const target=$('knowledgeResults');target.replaceChildren();
  try{
    const {sources}=await api('/knowledge/search',{query:$('knowledgeQuery').value});
    if(!sources.length){target.textContent='No indexed passages matched.';return;}
    for(const source of sources){
      const card=document.createElement('div');card.className='workflow-card';
      const title=document.createElement('strong');title.textContent=source.title;
      const p=document.createElement('p');p.textContent=source.excerpt;
      card.append(title,p);target.append(card);
    }
  }catch(e){target.textContent=e.message;}
});
$('groundedSearch').addEventListener('click',async()=>{
  const question=$('groundedQuery').value.trim();
  if(!question){toast('Enter a public web question.');return;}
  if(!confirm('Search Google with Gemini? Your question leaves this device and this request may incur API charges.'))return;
  $('groundedStatus').textContent='Searching with configured Gemini provider…';
  try{
    const result=await api('/web/search',{question});
    addMessage(question,'user');addMessage(result.answer,'assistant');renderWebReferences(result.sources);
    $('groundedStatus').textContent=result.grounded?'Grounded result with '+result.sources.length+' web sources.':'Google returned no source citations; verify the answer independently.';
  }catch(e){$('groundedStatus').textContent=e.message;}
});
addEventListener('pagehide',()=>{cadPreviewSession?.close();liveVoice?.stop();stopScreen();stopCamera();stopListening();stopSpeech();});
setupSpeech();

await Promise.allSettled([refreshGraph(),loadModels(),refreshFocus(),diagnostics(),loadProjects(),loadCapabilities(),loadSkills(),loadActions(),loadCADModels(),loadKnowledge(),loadMCP()]);
await refreshWorkflows(false);
try{const history=await api('/projects/history');restoreConversation(history.messages || []);}catch(e){toast('Project history unavailable: '+e.message);}
const hour=new Date().getHours();$('greeting').textContent=`Good ${hour<12?'morning':hour<17?'afternoon':'evening'}, sir. ${graph.nodes.length} notes indexed, all present and accounted for. What shall we explore?`;
await createGalaxy();setInterval(refreshFocus,1000);setInterval(()=>refreshWorkflows(true),30000);if(params.has('focusprobe'))runProbe();
