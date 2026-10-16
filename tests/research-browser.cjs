// Real Electron windows and isolated renderer. Public-site content is a local fixture.
const {_electron}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'arkus-research-'));
 const app=await _electron.launch({executablePath:path.resolve(process.env.ARKUS_ELECTRON_EXE||'dist/win-unpacked/ARKUS.exe'),
  env:{...process.env,ARKUS_PORT:'4704',ARKUS_PYTHON:'',ARKUS_TEST_HIDE:'1',ARKUS_TEST_MUTE:'1',ARKUS_TEST_DATA_DIR:data,ARKUS_CONFIG:path.join(data,'missing.json'),ARKUS_API_KEY:'',ARKUS_NOTES_DIR:''}});
 try{
  await app.firstWindow();
  await app.evaluate(async({BrowserWindow})=>{for(let n=0;n<100;n++){if(BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('http://127.0.0.1:4704')))return;await new Promise(r=>setTimeout(r,100));}throw Error('Main window missing');});
  await app.evaluate(({session})=>session.fromPartition('arkus-public-research').protocol.handle('https',()=>new Response('<html><title>Reference fixture</title><body>Fixture source text<a href="https://docs.python.org/3/library/math.html">Math reference</a><a href="https://evil.example/">Rejected reference</a></body></html>',{headers:{'content-type':'text/html'}})));
  const page=app.windows().find(w=>w.url().startsWith('http://127.0.0.1:4704'));const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.waitForFunction(()=>document.body.dataset.galaxy==='ready');await page.locator('#settingsToggle').click();
  await page.locator('#researchUrl').fill('https://docs.python.org/3/');await page.locator('#researchOpen').click();
  await page.locator('#researchResult').filter({hasText:'opened'}).waitFor();await page.locator('#researchRead').click();
  await page.locator('#researchResult').filter({hasText:'Fixture source text'}).waitFor();
  if(await page.locator('#researchLinks button').count()!==1)throw Error('Unapproved link exposed');
  await page.locator('#researchLinks button').click();
  await page.waitForFunction(()=>document.getElementById('researchResult').textContent.includes('library/math.html'));
  await page.locator('#researchClose').click();await page.locator('#researchResult').filter({hasText:'closed'}).waitFor();
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Real Electron research open/read/allowed-link navigation/close PASS; unapproved links absent; renderer errors 0. Public page supplied by local fixture; no external site or device acceptance claimed.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
