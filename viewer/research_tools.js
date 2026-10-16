// Explicitly consented, read-only Gemini Live research bridge.
// Public page text is untrusted evidence; it must not be used as instructions.
export const RESEARCH_VOICE_TOOLS=Object.freeze(['research_search','research_read','research_links','research_follow']);
export async function runLiveResearch(name,args,{enabled,invoke,confirmSearch}={}){
 if(!RESEARCH_VOICE_TOOLS.includes(name))throw new Error('Research tool not permitted.');
 if(enabled!==true)throw new Error('Enable public research consent in System controls before sharing browsing evidence with Gemini.');
 if(typeof invoke!=='function')throw new Error('The isolated Windows ARKUS research browser is unavailable.');
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Invalid research arguments.');
 const keys=Object.keys(args);
 let action,value;
 if(name==='research_search'){
  if(keys.length!==1||keys[0]!=='query'||typeof args.query!=='string'||!args.query.trim()||args.query.length>120)
   throw new Error('A single 1-120 character public research query is required.');
  value=args.query.trim();action='search';
  if(typeof confirmSearch!=='function'||await confirmSearch(value)!==true)
   throw new Error('Research search declined by the user.');
 }else if(name==='research_follow'){
  if(keys.length!==1||keys[0]!=='index'||!Number.isInteger(args.index)||args.index<1||args.index>12)
   throw new Error('A listed research link index from 1 through 12 is required.');
  value=args.index;action='follow';
 }else{
  if(keys.length)throw new Error('This research tool takes no arguments.');
  action=name==='research_read'?'read':'links';
 }
 const result=await invoke(action,value);
 if(!result||typeof result!=='object'||!['read','links','followed'].includes(result.status))
  throw new Error('Research did not produce a verified response.');
 if(typeof result.url!=='string'||!result.url.startsWith('https://'))
  throw new Error('Research returned no verified public HTTPS source.');
 return result;
}
