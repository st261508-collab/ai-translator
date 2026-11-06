// Real v1→v2 Service Worker upgrade with existing IndexedDB/preferences.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'kotoba-upgrade-')),site=path.join(temp,'ai-translator');fs.mkdirSync(site);
 // Pin the published v1 source so this test does not change when origin/main advances.
 const baseline='1d28045';
 const shell=['index.html','style.css','script.js','sw.js','manifest.webmanifest','icons/icon.svg','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png'];
 for(const file of shell){const dest=path.join(site,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,execFileSync('git',['show',`${baseline}:${file}`],{cwd:root}));}
 const server=spawn('python3',['-m','http.server','4174','--bind','127.0.0.1','--directory',temp],{stdio:'ignore'});let browser;
 try{
  for(let i=0;i<30;i++){try{await fetch('http://127.0.0.1:4174/');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const ctx=await browser.newContext();let page=await ctx.newPage();const base='http://127.0.0.1:4174/ai-translator/';
  await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.evaluate(async()=>{
   localStorage.setItem('kp-settings',JSON.stringify({source:'ja',foreign:'fr'}));localStorage.setItem('kp-model-marks',JSON.stringify({transformers:{pinned:true,favorite:true}}));localStorage.setItem('kp-save-history','true');
   await new Promise((resolve,reject)=>{const req=indexedDB.open('kotoba-pocket',1);req.onupgradeneeded=()=>{const s=req.result.createObjectStore('history',{keyPath:'id',autoIncrement:true});s.createIndex('createdAt','createdAt');};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('history','readwrite');tx.objectStore('history').add({original:'既存の文章',translated:'existing translation',from:'ja',to:'en',createdAt:1});tx.oncomplete=()=>{db.close();resolve();};};});
  });
  for(const file of [...shell,'model-registry.js'])fs.copyFileSync(path.join(root,file),path.join(site,file));
  await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
  // Old SW still controls navigation: new HTML must request v2 scripts by versioned URL.
  await page.reload();await page.waitForSelector('#translation-model option',{state:'attached'});assert.equal(await page.locator('#source-label').innerText(),'日本語');assert.equal(await page.locator('#target-label').innerText(),'フランス語');
  console.log('PASS v2 assets work during pending v1 update');
  await page.close();page=await ctx.newPage();await page.goto(base);
  await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('kotoba-pocket-shell-v2')&&!keys.includes('kotoba-pocket-shell-v1');});
  assert.equal(await page.locator('#target-label').innerText(),'フランス語');assert(await page.locator('#save-history').isChecked());
  await page.click('[data-page=history]');await page.waitForSelector('.history-card');assert.match(await page.locator('.history-card').innerText(),/既存の文章/);
  await page.click('[data-page=models]');assert.equal(await page.locator('.model-card').first().getAttribute('data-model-id'),'transformers');
  const version=await page.evaluate(()=>new Promise(resolve=>{const req=indexedDB.open('kotoba-pocket');req.onsuccess=()=>{resolve(req.result.version);req.result.close();};}));assert.equal(version,1);
  console.log('PASS existing IndexedDB v1, language, history preference and favorites preserved');
  await ctx.setOffline(true);await page.reload();await page.waitForSelector('#translation-model option',{state:'attached'});await page.click('[data-page=history]');await page.waitForSelector('.history-card');console.log('PASS v2 shell and existing history work offline');await ctx.close();
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
