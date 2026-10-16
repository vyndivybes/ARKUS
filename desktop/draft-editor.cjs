'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
function createDraftEditor({dataDir,systemRoot=process.env.SystemRoot,launch=spawn}){
 const root=path.resolve(dataDir);
 return async function open(project,name){
  if(process.platform!=='win32')throw Error('The draft editor requires Windows.');
  if(typeof project!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project)||
     typeof name!=='string'||name.length>80||!/^([A-Za-z0-9][A-Za-z0-9_.-]{0,75})\.(md|txt|json|py|js|csv)$/.test(name))throw Error('Invalid project draft.');
  const folders=[root,path.join(root,'projects'),path.join(root,'projects',project),path.join(root,'projects',project,'drafts')];
  const file=path.join(folders.at(-1),name);
  for(const item of [...folders,file])if(fs.lstatSync(item).isSymbolicLink())throw Error('Linked draft paths are not permitted.');
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>100000)throw Error('The saved draft is unavailable or too large.');
  const relative=path.relative(fs.realpathSync(root),fs.realpathSync(file));
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Draft path escapes project data.');
  if(typeof systemRoot!=='string'||!path.isAbsolute(systemRoot))throw Error('Windows system directory unavailable.');
  // Always open source drafts as text. Never use their file association or a shell.
  const executable=path.join(systemRoot,'System32','notepad.exe');
  return new Promise((resolve,reject)=>{
   const child=launch(executable,[file],{shell:false,windowsHide:false,stdio:'ignore'});
   child.once('error',()=>reject(Error('Windows Notepad could not be started.')));
   child.once('spawn',()=>{child.unref();resolve({started:true,application:'Notepad',name,project});});
  });
 };
}
module.exports={createDraftEditor};
