const test=require('node:test');const assert=require('node:assert/strict');const {safeUrl,shortText,normalizeQuery}=require('../desktop/research-utils.cjs');
test('public knowledge sites only',()=>{assert.equal(safeUrl('https://en.wikipedia.org/wiki/Bicycle'),'https://en.wikipedia.org/wiki/Bicycle');for(const u of ['http://github.com/','https://127.0.0.1','https://localhost','https://evil.github.com','https://github.com.evil.test','https://user:pw@github.com/','file:///etc/passwd','javascript:alert(1)','https://github.com:444/'])assert.throws(()=>safeUrl(u));});
test('content and search text bounded',()=>{assert.equal(shortText('hi\0there'),'hithere');assert.equal(shortText('x'.repeat(9000)).length,6000);assert.throws(()=>normalizeQuery(''));assert.throws(()=>normalizeQuery('x'.repeat(150)));});

test('reference links reject private addresses, scripts and external hosts and remain bounded',()=>{
 const {safeLinks}=require('../desktop/research-utils.cjs');
 const links=safeLinks([{url:'https://docs.python.org/3/',text:'Python'},
   {url:'https://docs.python.org/3/#intro',text:'Duplicate'}, {url:'javascript:alert(1)',text:'bad'},
   {url:'https://evil.example',text:'bad'}, {url:'https://127.0.0.1',text:'private'},
   {url:'https://github.com/vyndivybes/ARKUS',text:'x'.repeat(200)}]);
 assert.equal(links.length,2);assert.equal(links[0].text,'Python');assert.equal(links[1].text.length,160);
 assert.equal(safeLinks(Array.from({length:100},(_,i)=>({url:'https://github.com/'+i}))).length,30);
});

test('approved research must stay on the original host even through allowlisted redirects',()=>{
 const {requireApprovedResearchHost}=require('../desktop/research-utils.cjs');
 assert.equal(requireApprovedResearchHost('https://docs.python.org/3/','https://docs.python.org/3/library/'),true);
 assert.throws(()=>requireApprovedResearchHost('https://docs.python.org/3/','https://github.com/vyndivybes/ARKUS'),/approved host/i);
 assert.throws(()=>requireApprovedResearchHost('https://docs.python.org/3/','https://evil.example/'));
});
