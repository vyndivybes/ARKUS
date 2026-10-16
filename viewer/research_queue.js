// Read-only, explicitly approved research queue for the isolated ARKUS desktop window.
// The public page is untrusted evidence; no remote HTML, scripts or link actions execute here.
const HOSTS=new Set(['en.wikipedia.org','www.wikipedia.org','github.com','docs.python.org',
                     'developer.mozilla.org','arxiv.org','pypi.org']);
function normalizeUrl(value){
  if(typeof value!=='string'||!value||value.length>1200)throw Error('Enter a bounded public HTTPS URL.');
  let url;
  try{url=new URL(value);}catch{throw Error('Invalid reference URL.');}
  if(url.protocol!=='https:'||!HOSTS.has(url.hostname.toLowerCase())||
     url.username||url.password||url.port||url.href.length>1300)
    throw Error('Only approved public HTTPS reference sites can enter the queue.');
  url.hash='';
  return url.toString();
}
export function normalizeReferenceQueue(text){
  if(typeof text!=='string'||text.length>6500)throw Error('Research plan is too long.');
  const rows=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(rows.length<1||rows.length>5)throw Error('Enter 1 to 5 public reference URLs, one per line.');
  const urls=rows.map(normalizeUrl);
  if(new Set(urls).size!==urls.length)throw Error('Remove duplicate research URLs.');
  return urls;
}
export function createResearchQueue({review,approve,onUpdate=()=>{}}){
  if(typeof review!=='function'||typeof approve!=='function')throw Error('Research queue needs an approval and reader.');
  let generation=0,steps=[],results=[],index=0,busy=false,pendingApproval=false,error='';
  const status=()=>busy?(pendingApproval?'awaiting_approval':'reading')
    :!steps.length?'idle':index===steps.length?'complete':'ready';
  const state=()=>({status:status(),steps:[...steps],index,results:results.map(x=>({...x})),error});
  const notify=()=>onUpdate(state());
  function cancel(){
    generation++;steps=[];results=[];index=0;busy=false;pendingApproval=false;error='';notify();
  }
  function plan(text){
    if(busy)throw Error('Cancel the current operation before creating a new research plan.');
    const selected=normalizeReferenceQueue(text);
    generation++;steps=selected;results=[];index=0;error='';notify();return state();
  }
  async function next(){
    if(busy||!steps.length||index>=steps.length)return null;
    const current=++generation,url=steps[index];
    busy=true;pendingApproval=true;error='';notify();
    try{
      const accepted=await approve(url,index+1,steps.length);
      if(current!==generation)return null;
      pendingApproval=false;notify();
      if(accepted!==true)return null;
      const response=await review(url);
      if(current!==generation)return null;
      if(!response||response.status!=='read'||typeof response.url!=='string')
        throw Error('The approved reference did not return a completed read.');
      // Navigation redirects stay governed by the native desktop allowlist.
      const landed=normalizeUrl(response.url);
      const result={url:landed,requested:url,
        title:String(response.title??'').slice(0,160),
        text:String(response.text??'').slice(0,6000)};
      results.push(result);index++;return {...result};
    }catch(cause){
      if(current!==generation)return null;
      error=String(cause?.message||'Research read failed.').slice(0,240);
      throw Error(error);
    }finally{
      if(current===generation){busy=false;pendingApproval=false;notify();}
    }
  }
  return {plan,next,cancel,state};
}
