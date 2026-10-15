require('./vendor.cjs');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
if(process.platform!=='win32')throw new Error('Windows packaging must run on Windows.');
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'prepare-python.ps1')],{stdio:'inherit',windowsHide:true});
