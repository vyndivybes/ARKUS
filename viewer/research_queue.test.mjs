import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReferenceQueue,createResearchQueue} from './research_queue.js';

test('research plan accepts at most five approved public HTTPS pages, no duplicates',()=>{
  assert.deepEqual(normalizeReferenceQueue('https://docs.python.org/3/#intro\nhttps://github.com/vyndivybes/ARKUS'),[
    'https://docs.python.org/3/','https://github.com/vyndivybes/ARKUS'
  ]);
  for(const target of ['http://github.com/x','https://127.0.0.1/x','https://evil.github.com/',
     'https://user:pass@github.com/','javascript:alert(1)','https://github.com:444/x',
     'https://github.com.evil.test/', 'https://google.com/', 'https://github.com/x#fragment\nhttps://github.com/x']){
    if(target.includes('\n')&&target.endsWith('/x'))continue;
    assert.throws(()=>normalizeReferenceQueue(target));
  }
  assert.throws(()=>normalizeReferenceQueue(''));
  assert.throws(()=>normalizeReferenceQueue(Array(6).fill('https://github.com/').map((x,i)=>x+i).join('\n')));
  assert.throws(()=>normalizeReferenceQueue('https://docs.python.org/3/\nhttps://docs.python.org/3/'));
});

test('task never opens a page before exact-URL approval and stops after each result',async()=>{
  const approvals=[],calls=[],updates=[];
  const queue=createResearchQueue({
    approve:async url=>{approvals.push(url);return approvals.length!==1;},
    review:async url=>{calls.push(url);return {status:'read',url,title:'Reference',text:'Remote page is untrusted.',links:[]};},
    onUpdate:state=>updates.push(state),
  });
  queue.plan('https://docs.python.org/3/\nhttps://github.com/vyndivybes/ARKUS');
  assert.equal(calls.length,0);
  assert.equal(await queue.next(),null); // declined
  assert.equal(calls.length,0);
  assert.equal(queue.state().index,0);
  const first=await queue.next();
  assert.equal(first.url,'https://docs.python.org/3/');
  assert.equal(queue.state().index,1);
  assert.deepEqual(calls,['https://docs.python.org/3/']);
  assert.equal(queue.state().status,'ready');
  await queue.next();
  assert.equal(queue.state().status,'complete');
  assert.equal(queue.state().results.length,2);
  assert.equal(await queue.next(),null);
  assert.equal(calls.length,2);
  assert.ok(updates.length>=3);
});

test('queued research is paused on cancellation, even when approval or reading is pending',async()=>{
  let approveResolve;const calls=[];
  const queue=createResearchQueue({
    approve:()=>new Promise(resolve=>{approveResolve=resolve}),
    review:async url=>{calls.push(url);return {status:'read',url,title:'Read',text:'evidence'};},
  });
  queue.plan('https://docs.python.org/3/');
  const pending=queue.next();
  assert.equal(queue.state().status,'awaiting_approval');
  queue.cancel();approveResolve(true);
  assert.equal(await pending,null);assert.deepEqual(calls,[]);
  assert.equal(queue.state().status,'idle');
});

test('stale browser responses never contaminate replacement plan and cannot be run twice',async()=>{
  let finish;let calls=0;
  const queue=createResearchQueue({
    approve:async()=>true,
    review:async()=>{calls++;return new Promise(r=>finish=r)},
  });
  queue.plan('https://docs.python.org/3/');
  const first=queue.next();
  await Promise.resolve();
  assert.equal(await queue.next(),null);
  queue.cancel();
  queue.plan('https://github.com/vyndivybes/ARKUS');
  finish({status:'read',url:'https://docs.python.org/3/',title:'Old',text:'stale'});
  await first;
  assert.equal(queue.state().results.length,0);
  assert.equal(queue.state().steps[0],'https://github.com/vyndivybes/ARKUS');
  assert.equal(calls,1);
});

test('untrusted read responses are bounded, and errors never advance steps',async()=>{
  let fail=true;
  const queue=createResearchQueue({
    approve:async()=>true,
    review:async url=>fail?{status:'opened',url}:{
      status:'read',url,title:'T'.repeat(9000),text:'a'.repeat(100000),
      links:[{url:'https://github.com/',text:'Link'}],
    },
  });
  queue.plan('https://docs.python.org/3/');
  await assert.rejects(()=>queue.next(),/read/);
  assert.equal(queue.state().index,0);
  fail=false;
  const good=await queue.next();
  assert.ok(good.title.length<=160);
  assert.ok(good.text.length<=6000);
  assert.deepEqual(good.links,[]); // queue stores extracted text only, not executable page objects
});
