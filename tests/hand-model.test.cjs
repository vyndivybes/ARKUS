const test=require('node:test'),assert=require('node:assert/strict');
const {verifyModel}=require('../scripts/prepare-hand-model.cjs');
test('hand model downloader rejects nonmodel and falsified content without network access',()=>{
  assert.equal(verifyModel(Buffer.alloc(10)),false);
  assert.equal(verifyModel(Buffer.alloc(7819105)),false);
  assert.equal(verifyModel(null),false);
});
