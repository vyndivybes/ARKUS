require('./vendor.cjs');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
if(process.platform!=='win32')throw new Error('Windows packaging must run on Windows.');
require('./prepare-hand-model.cjs').downloadModel().then(()=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'prepare-python.ps1')],{stdio:'inherit',windowsHide:true})).catch(error=>{console.error(error.message);process.exitCode=1;});
