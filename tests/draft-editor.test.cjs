const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createDraftEditor}=require('../desktop/draft-editor.cjs');
test('saved source drafts open only through fixed Notepad arguments without a shell',{skip:process.platform!=='win32'},async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'arkus-editor-')),folder=path.join(data,'projects','general','drafts');fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'draft.py'),'raise RuntimeError("not executed")');let called;
 const open=createDraftEditor({dataDir:data,systemRoot:'C:\\Windows',launch:(...args)=>{
   called=args;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 assert.equal((await open('general','draft.py')).started,true);
 assert.equal(called[0],'C:\\Windows\\System32\\notepad.exe');assert.deepEqual(called[1],[path.join(folder,'draft.py')]);assert.equal(called[2].shell,false);
 for(const [project,name] of [['../escape','draft.py'],['general','../outside.py'],['general','run.exe'],['general','x.py & calc']])await assert.rejects(open(project,name));
 assert.throws(()=>fs.statSync(path.join(folder,'must-not-exist')));
});
test('draft editor reports launch errors instead of claiming success',{skip:process.platform!=='win32'},async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'arkus-editor-')),folder=path.join(data,'projects','general','drafts');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'draft.md'),'text');
 const open=createDraftEditor({dataDir:data,systemRoot:'C:\\Windows',launch:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Error('PRIVATE')));return child;}});
 await assert.rejects(open('general','draft.md'),/Notepad could not be started/);
});
