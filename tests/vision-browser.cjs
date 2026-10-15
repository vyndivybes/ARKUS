// Synthetic camera only. Never opens the user's webcam or sends a vision frame.
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['camera']});
  const page=await context.newPage();
  const samples=[],external=[],errors=[];
  page.on('request',r=>{
    if(!r.url().startsWith('http://127.0.0.1:4700/'))external.push(r.url());
    if(r.url().endsWith('/focus/posture'))samples.push(r.postDataJSON());
    if(r.url().endsWith('/see'))errors.push('Unexpected frame upload');
  });
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4700/?mute=1',{waitUntil:'networkidle'});
  await page.locator('#settingsToggle').click();
  await page.locator('#startCamera').click();
  await page.locator('#cameraPreview').waitFor({state:'visible'});
  await page.locator('#postureConsent').check();
  await page.waitForFunction(()=>!document.getElementById('calibratePosture').disabled,{timeout:45000});
  await page.waitForFunction(()=>document.getElementById('postureStatus').textContent.includes('Local inference ready'),{timeout:20000});
  await page.waitForResponse(r=>r.url().endsWith('/focus/posture') && typeof r.request().postDataJSON()?.present==='boolean',{timeout:15000});
  if(!samples.some(s=>Object.keys(s).sort().join(',')==='head_down,present,slouched' && Object.values(s).every(v=>typeof v==='boolean')))throw new Error('No strict boolean sample');
  await page.locator('#stopCamera').click();
  await page.waitForFunction(()=>document.getElementById('postureConsent').checked===false);
  await page.waitForTimeout(350);
  if(samples.at(-1)?.enabled!==false)throw new Error('Opt-out did not clear server state');
  if(external.length || errors.length)throw new Error(JSON.stringify({external,errors}));
  console.log('Synthetic camera + local MediaPipe WASM/model inference + boolean-only samples + opt-out PASS; external requests 0; frame uploads 0');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
