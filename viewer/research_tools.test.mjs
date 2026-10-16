import test from 'node:test';
import assert from 'node:assert/strict';
import {runLiveResearch,RESEARCH_VOICE_TOOLS} from './research_tools.js';

test('public research remains disabled without local consent or desktop bridge', async()=>{
 let calls=0;
 const invoke=async()=>{calls++;return {status:'read',url:'https://en.wikipedia.org/wiki/Bicycle'};};
 await assert.rejects(runLiveResearch('research_read',{}, {enabled:false,invoke}),/consent/i);
 await assert.rejects(runLiveResearch('research_read',{}, {enabled:true}),/Windows/i);
 await assert.rejects(runLiveResearch('research_shell',{command:'whoami'}, {enabled:true,invoke}),/not permitted/i);
 assert.equal(calls,0);
});
test('spoken research can search only after showing exact query for approval', async()=>{
 const calls=[], confirms=[];
 const invoke=async(...args)=>{calls.push(args);return {status:'read',url:'https://en.wikipedia.org/wiki/Bicycle',title:'Bicycle',text:'A bicycle has two wheels.'};};
 const confirmSearch=q=>{confirms.push(q);return false;};
 await assert.rejects(runLiveResearch('research_search',{query:'Bicycle frame'}, {enabled:true,invoke,confirmSearch}),/declined/i);
 assert.deepEqual(confirms,['Bicycle frame']);assert.deepEqual(calls,[]);
 const result=await runLiveResearch('research_search',{query:'Bicycle frame'}, {enabled:true,invoke,confirmSearch:()=>true});
 assert.equal(result.status,'read');assert.deepEqual(calls,[['search','Bicycle frame']]);
 assert.equal(result.url,'https://en.wikipedia.org/wiki/Bicycle');
});
test('read/links/follow permit no arbitrary URLs, scripts, clicks, forms, or private fields',async()=>{
 const calls=[];
 const invoke=async(...args)=>{calls.push(args);return {status:'links',url:'https://en.wikipedia.org/wiki/Cycling',links:[]};};
 for(const [name,args] of [
  ['research_read',{url:'https://private.example'}],
  ['research_links',{cookie:true}],
  ['research_follow',{index:'https://github.com'}],
  ['research_follow',{index:13}],
  ['research_follow',{index:0}],
  ['research_search',{query:'hello',url:'https://example.org'}]
 ]) await assert.rejects(runLiveResearch(name,args,{enabled:true,invoke,confirmSearch:()=>true}),/arguments|index|query/i);
 assert.equal(calls.length,0);
 await runLiveResearch('research_read',{}, {enabled:true,invoke});
 await runLiveResearch('research_links',{}, {enabled:true,invoke});
 await runLiveResearch('research_follow',{index:2}, {enabled:true,invoke});
 assert.deepEqual(calls,[['read',undefined],['links',undefined],['follow',2]]);
 assert.deepEqual(RESEARCH_VOICE_TOOLS,['research_search','research_read','research_links','research_follow']);
});
