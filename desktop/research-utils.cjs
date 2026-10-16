'use strict';
const HOSTS=new Set(['en.wikipedia.org','www.wikipedia.org','github.com','docs.python.org','developer.mozilla.org','arxiv.org','pypi.org']);
function safeUrl(value){
 if(typeof value!=='string'||value.length>1200)throw Error('Enter a bounded public HTTPS URL.');
 let url;try{url=new URL(value)}catch{throw Error('Invalid URL.')}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!HOSTS.has(url.hostname.toLowerCase()))throw Error('Only approved public HTTPS reference sites are allowed.');
 if(url.href.length>1300)throw Error('URL too long.');
 url.hash='';return url.toString();
}
function shortText(value){return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').slice(0,6000)}
function normalizeQuery(value){if(typeof value!=='string'||!value.trim()||value.length>120)throw Error('Enter up to 120 characters to find.');return value.trim()}

function safeLinkList(items){
 if(!Array.isArray(items))throw Error('Invalid public link list.');
 const seen=new Set(),out=[];
 for(const item of items.slice(0,100)){
  if(!item||typeof item.href!=='string')continue;
  let url;try{url=safeUrl(item.href)}catch{continue}
  if(seen.has(url))continue;
  seen.add(url);
  const title=shortText(item.title||new URL(url).pathname||new URL(url).hostname).trim().slice(0,100);
  out.push({index:out.length+1,title:title||new URL(url).hostname,url});
  if(out.length===12)break;
 }
 return out;
}
function chooseResearchLink(list,index){
 if(!Array.isArray(list)||!Number.isInteger(index)||index<1||index>list.length)throw Error('Choose a listed public link number.');
 const selected=list[index-1];
 if(!selected||selected.index!==index)throw Error('Research link snapshot is invalid.');
 return safeUrl(selected.url);
}
function verifyNavigation(requested,actual){
 const start=safeUrl(requested),end=safeUrl(actual);
 return {verified:true,requested:start,url:end,redirected:start!==end};
}
module.exports={safeUrl,shortText,normalizeQuery,safeLinkList,chooseResearchLink,verifyNavigation};
