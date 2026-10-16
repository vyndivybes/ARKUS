// Real local HTTP and rendered UI, isolated test data, no media or provider calls.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'arkus-workflows-'));
 const port=4703,base='http://127.0.0.1:'+port;
 const server=spawn(process.env.ARKUS_TEST_PYTHON||'python',['server.py','--port',String(port),'--data',data,'--notes',path.join(data,'notes')],{
   windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ARKUS_CONFIG:path.join(data,'missing-config.json'),ARKUS_API_KEY:'',ARKUS_NOTES_DIR:''}});
 let browser,serverLog='';
 server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);server.on('error',e=>serverLog+=e.message);
 try{
  for(let n=0;n<300;n++){
   try{if((await fetch(base+'/api/status')).ok)break;}catch{}
   if(n===299)throw Error('Test server did not start: '+serverLog);await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch({headless:true,channel:process.env.ARKUS_BROWSER_CHANNEL||'msedge'});
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(base+'/?mute=1');await page.waitForFunction(()=>document.body.dataset.project==='general');
  await page.locator('#settingsToggle').click();
  const baseSpec={name:'calc',description:'Sum',operation:'add',inputs:['a','b']};
  await page.locator('#manualSkill').fill(JSON.stringify(baseSpec));await page.locator('#createManualSkill').click();
  const registry=page.locator('#skillRegistry');
  await registry.getByRole('button',{name:'Test locally',exact:true}).click();
  await registry.getByRole('button',{name:'Activate skill',exact:true}).click();
  await registry.getByText('calc · revision 1 · active',{exact:true}).waitFor();
  const upgrade={...baseSpec,operation:'multiply',tests:[{parameters:{a:3,b:4},expected:99}]};
  await page.locator('#manualSkill').fill(JSON.stringify(upgrade));await registry.getByRole('button',{name:'Draft upgrade',exact:true}).click();
  await registry.getByRole('button',{name:'Test locally',exact:true}).click();
  await page.locator('#toast').filter({hasText:'Acceptance example 1 failed'}).waitFor();
  await registry.getByText('calc · revision 1 · active',{exact:true}).waitFor();
  upgrade.tests[0].expected=12;
  await page.locator('#manualSkill').fill(JSON.stringify(upgrade));await registry.getByRole('button',{name:'Draft upgrade',exact:true}).click();
  await registry.getByRole('button',{name:'Test locally',exact:true}).last().click();
  await registry.getByRole('button',{name:'Activate skill',exact:true}).click();
  await registry.getByRole('button',{name:'Roll back',exact:true}).click();
  await registry.getByText('calc · revision 1 · active',{exact:true}).waitFor();
  await page.locator('#draftFilename').fill('example.py');await page.locator('#draftContent').fill('raise RuntimeError("must never execute")');
  await page.locator('#draftSave').click();await page.locator('#toast').filter({hasText:'Saved project draft'}).waitFor();
  await page.locator('#draftValidate').click();await page.locator('#draftValidation').filter({hasText:'Valid saved syntax'}).waitFor();
  await page.locator('#newProject').fill('Isolated');await page.locator('#createProject').click();
  await page.waitForFunction(()=>document.body.dataset.project==='isolated');
  await page.waitForFunction(()=>document.getElementById('draftContent').value==='');
  await registry.getByText('No custom skills in this project.',{exact:true}).waitFor();
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Rendered skill draft/test/activate, failed upgrade isolation, tested upgrade/rollback, nonexecuting syntax validation and project switch PASS; renderer errors 0; no media/provider calls.');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
