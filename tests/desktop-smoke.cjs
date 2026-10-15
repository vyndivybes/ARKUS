// Packaged app + real local Python backend. No screen or webcam capture.
const {_electron}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
  const data=path.resolve('work/desktop-test-data');fs.mkdirSync(data,{recursive:true});
  const environment={...process.env};for(const key of Object.keys(environment))if(key.toLowerCase()==='path')delete environment[key];
  environment.PATH=[path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot,path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0')].join(';');
  const application=await _electron.launch({executablePath:path.resolve('dist/win-unpacked/ARKUS.exe'),env:{...environment,ARKUS_PORT:'4701',ARKUS_PYTHON:'',ARKUS_TEST_MUTE:'1',ARKUS_TEST_HIDE:'1',ARKUS_TEST_DATA_DIR:data,ARKUS_CONFIG:path.join(data,'missing-config.json'),ARKUS_API_KEY:'',ARKUS_NOTES_DIR:''},timeout:45000});
  await application.firstWindow();
  await application.evaluate(async ({BrowserWindow})=>{for(let i=0;i<100;i++){if(BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('http://127.0.0.1:4701')))return;await new Promise(r=>setTimeout(r,100));}throw Error('Main viewer did not navigate');});
  const page=application.windows().find(p=>p.url().startsWith('http://127.0.0.1:4701'));
  if(!page)throw new Error('Main viewer page unavailable');
  page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('renderer',m.text().slice(0,300));});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  console.log('Desktop window',await page.evaluate(()=>({title:document.title,galaxy:document.body.dataset.galaxy})));
  await page.waitForFunction(()=>document.body.dataset.galaxy==='ready',undefined,{timeout:20000});
  await page.locator('#settingsToggle').click();
  await page.locator('#focusStart').click();
  await page.locator('#focusBadge').filter({hasText:'FOCUSING'}).waitFor();
  const card=application.windows().find(p=>p!==page);
  if(!card)throw new Error('Countdown card missing');
  await card.waitForFunction(()=>document.getElementById('status').textContent.includes('Timer only'));
  await card.locator('#pause').click();
  await page.locator('#focusBadge').filter({hasText:'PAUSED'}).waitFor();
  await card.locator('#abort').click();
  await page.locator('#focusBadge').filter({hasText:'OFF'}).waitFor();
  const optedIn=await application.evaluate(({Menu})=>{const menu=Menu.getApplicationMenu().items[0].submenu.items[0];menu.click(menu);return menu.checked;});
  if(!optedIn)throw new Error('Sensor menu did not opt in');
  const limit=Date.now()+25000;
  let readable=false;
  while(Date.now()<limit){const r=await fetch('http://127.0.0.1:4701/focus/diag');const d=await r.json();if(d.frontmost_readable){readable=true;break;}await new Promise(r=>setTimeout(r,500));}
  if(!readable)throw new Error('Windows foreground sensor did not produce a fresh reading');
  await application.evaluate(({Menu})=>{const menu=Menu.getApplicationMenu().items[0].submenu.items[0];menu.click(menu);});
  await application.close();
  console.log('Packaged Windows app + Python backend + WebGL + live countdown bridge + card pause/end + opt-in fresh Windows sensor PASS; no screen/webcam capture');
})().catch(e=>{console.error(e);process.exit(1);});
