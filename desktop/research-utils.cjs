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
module.exports={safeUrl,shortText,normalizeQuery};
