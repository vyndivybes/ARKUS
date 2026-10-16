'use strict';
const {BrowserWindow,session}=require('electron');
const {safeUrl,shortText,normalizeQuery}=require('./research-utils.cjs');
function createResearchWindow(owner){
 let window=null;
 const partition='arkus-public-research';
 const researchSession=session.fromPartition(partition,{cache:false});
 researchSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 researchSession.setPermissionCheckHandler(()=>false);
 // Block unapproved cross-host requests and scheme navigations, including redirects.
 researchSession.webRequest.onBeforeRequest((details,callback)=>{
   if(!details.url.startsWith('http'))return callback({cancel:true});
   try{safeUrl(details.url);callback({cancel:false});}
   catch{callback({cancel:true});}
 });
 async function perform(action,value){
  if(action==='close'){if(window&&!window.isDestroyed())window.close();window=null;return {status:'closed'};}
  if(action==='open'){
   const url=safeUrl(value);
   if(!window||window.isDestroyed()){
     window=new BrowserWindow({parent:owner,width:1050,height:780,title:'ARKUS · Public Research',webPreferences:{
       partition,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,
       javascript:false
     }});
     window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
     window.webContents.on('will-navigate',(event,url)=>{try{safeUrl(url)}catch{event.preventDefault()}});
   }
   await window.loadURL(url);
   return {status:'opened',url:safeUrl(window.webContents.getURL())};
  }
  if(!window||window.isDestroyed())throw Error('Open a reference page first.');
  if(action==='read'){
   const result=await window.webContents.executeJavaScript(
    '({title:document.title,text:(document.body?.innerText||"").slice(0,6000)})',true);
   return {status:'read',url:safeUrl(window.webContents.getURL()),title:shortText(result.title).slice(0,160),
     text:shortText(result.text)};
  }
  if(action==='find'){
    const needle=normalizeQuery(value);
    const result=await window.webContents.executeJavaScript(
      'document.body?.innerText?.slice(0,200000)||""',true);
    const text=String(result).toLowerCase(),q=needle.toLowerCase();
    let found=0,offset=0;while((offset=text.indexOf(q,offset))>=0&&found<200){found++;offset+=q.length;}
    return {status:'found',matches:found,url:safeUrl(window.webContents.getURL())};
  }
  throw Error('Unsupported research operation.');
 }
 return {perform,close(){if(window&&!window.isDestroyed())window.close();window=null;}};
}
module.exports={createResearchWindow};
