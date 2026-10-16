const test=require('node:test');const assert=require('node:assert/strict');const {safeUrl,shortText,normalizeQuery}=require('../desktop/research-utils.cjs');
test('public knowledge sites only',()=>{assert.equal(safeUrl('https://en.wikipedia.org/wiki/Bicycle'),'https://en.wikipedia.org/wiki/Bicycle');for(const u of ['http://github.com/','https://127.0.0.1','https://localhost','https://evil.github.com','https://github.com.evil.test','https://user:pw@github.com/','file:///etc/passwd','javascript:alert(1)','https://github.com:444/'])assert.throws(()=>safeUrl(u));});
test('content and search text bounded',()=>{assert.equal(shortText('hi\0there'),'hithere');assert.equal(shortText('x'.repeat(9000)).length,6000);assert.throws(()=>normalizeQuery(''));assert.throws(()=>normalizeQuery('x'.repeat(150)));});

const {safeLinkList,chooseResearchLink,verifyNavigation}=require('../desktop/research-utils.cjs');
test('public link discovery is bounded, deduplicated, and never exposes unsafe destinations',()=>{
  const links=safeLinkList([
    {title:'A bicycle',href:'https://en.wikipedia.org/wiki/Bicycle'},
    {title:'Duplicated',href:'https://en.wikipedia.org/wiki/Bicycle'},
    {title:'Unsafe',href:'http://127.0.0.1/private'},
    {title:'Untrusted',href:'javascript:alert(1)'},
    {title:'Credentials',href:'https://user:pw@github.com/private'},
    {title:'Source code',href:'https://github.com/openai/openai'},
    {title:'Documents',href:'https://docs.python.org/3/'},
  ]);
  assert.deepEqual(links.map(x=>x.index),[1,2,3]);
  assert.deepEqual(links.map(x=>x.title),['A bicycle','Source code','Documents']);
  assert.equal(chooseResearchLink(links,2),'https://github.com/openai/openai');
  assert.throws(()=>chooseResearchLink(links,4));
  assert.throws(()=>chooseResearchLink(links,'https://github.com/openai/openai'));
  assert.throws(()=>chooseResearchLink(links,0));
  assert.throws(()=>chooseResearchLink(links,1.5));
});
test('verified navigation cannot attest to unapproved URL or unsupported redirects',()=>{
  const a=verifyNavigation('https://en.wikipedia.org/wiki/Bicycle','https://en.wikipedia.org/wiki/Bicycle');
  assert.equal(a.verified,true);assert.equal(a.redirected,false);
  const b=verifyNavigation('https://en.wikipedia.org/wiki/Bicycle','https://en.wikipedia.org/wiki/Cycling');
  assert.equal(b.verified,true);assert.equal(b.redirected,true);
  assert.throws(()=>verifyNavigation('https://en.wikipedia.org/wiki/Bicycle','http://localhost/admin'));
  assert.throws(()=>verifyNavigation('https://en.wikipedia.org/wiki/Bicycle','https://evil.example'));
});
test('returned link snapshot caps titles and count',()=>{
  const entries=Array.from({length:50},(_,i)=>({title:'A'.repeat(300),href:'https://en.wikipedia.org/wiki/Bicycle_'+i}));
  const links=safeLinkList(entries);assert.equal(links.length,12);
  assert.ok(links.every(x=>x.title.length<=100 && x.url.startsWith('https://')));
  assert.deepEqual(links.map(x=>x.index),Array.from({length:12},(_,i)=>i+1));
});
