// Fetch the pinned, publicly hosted MediaPipe hand model only during an explicit
// source setup or Windows packaging. Runtime inference stays on the user's device.
// Source: nazirlouis/ada_v2, commit d005af7, public/hand_landmarker.task.
const fs=require('node:fs');
const path=require('node:path');
const https=require('node:https');
const crypto=require('node:crypto');
const expectedSize=7819105;
const expectedBlob='0d53faf3786146e95c5bc010c48029ff16b7fa59';
const url='https://raw.githubusercontent.com/nazirlouis/ada_v2/d005af742fc5c604074b8b92bd9a223d7fca7447/public/hand_landmarker.task';
const target=path.join(__dirname,'..','viewer','models','hand_landmarker.task');

function verifyModel(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length!==expectedSize)return false;
  return crypto.createHash('sha1').update('blob '+bytes.length+'\\0').update(bytes).digest('hex')===expectedBlob;
}
async function downloadModel(){
  if(fs.existsSync(target) && verifyModel(fs.readFileSync(target))){
    console.log('Pinned hand model already qualified locally.');
    return target;
  }
  const bytes=await new Promise((resolve,reject)=>{
    const req=https.get(url,{timeout:45000},res=>{
      if(res.statusCode!==200){res.resume();reject(new Error('Hand model download failed: HTTP '+res.statusCode));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{
        size+=chunk.length;
        if(size>expectedSize){req.destroy(new Error('Hand model exceeded expected size.'));return;}
        chunks.push(chunk);
      });
      res.on('end',()=>resolve(Buffer.concat(chunks)));
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(new Error('Hand model download timed out.')));
    req.on('error',reject);
  });
  if(!verifyModel(bytes))throw new Error('Hand model digest mismatch; refusing unsigned model.');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+'.'+process.pid+'.tmp';
  try{fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,target);}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  console.log('Pinned hand model copied and content verified.');
  return target;
}
module.exports={verifyModel,downloadModel};
if(require.main===module){downloadModel().catch(error=>{console.error(error.message);process.exitCode=1;});}
