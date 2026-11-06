const assert=require('node:assert/strict');const fs=require('node:fs');const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});let passed=0;const test=async(name,fn)=>{await fn();console.log('PASS '+name);passed++;};
 try{const context=await browser.newContext({viewport:{width:390,height:844}});await context.addInitScript(()=>{window.Translator=undefined;window.LanguageDetector=undefined;Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied=text,readText:async()=>window.__copied||''}});});const page=await context.newPage(),errors=[],apiCalls=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')apiCalls.push(r.url());});await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:4173/ai-translator/');
  await test('Safari fallback, disabled styles/reasoning and last engine retained',async()=>{assert.equal(await page.inputValue('#translation-model'),'transformers');assert(await page.locator('#translation-style').isDisabled());assert(await page.locator('#reasoning-level').isDisabled());await page.selectOption('#translation-model','transformers');await page.reload();assert.equal(await page.inputValue('#translation-model'),'transformers');});
  await test('Real local-engine metadata network failure is visible; no false translation',async()=>{
   await page.route('https://huggingface.co/**',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"test policy denial"}',headers:{'access-control-allow-origin':'*'}}));await page.click('#open-settings');await page.selectOption('#source-language','en');await page.locator('#settings .primary').click();await page.fill('#source-text','hello');await page.click('#translate');await page.waitForSelector('#translation-error:not([hidden])');assert.match(await page.locator('#translation-error').innerText(),/403/);assert(await page.locator('#copy').isDisabled());assert.equal(await page.inputValue('#source-text'),'hello');
  });
  await test('Public metadata validation: size/license/revision checked without mock inference',async()=>{
   const fixture={sha:'a'.repeat(40),cardData:{license:'apache-2.0'},siblings:[{rfilename:'onnx/encoder_model_quantized.onnx',size:100},{rfilename:'onnx/decoder_model_merged_quantized.onnx',size:200},{rfilename:'tokenizer.json',size:10}]};
   await page.unroute('https://huggingface.co/**');await page.route('https://huggingface.co/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture),headers:{'access-control-allow-origin':'*'}}));
   const meta=await page.evaluate(()=>LocalTranslation.inspect('en','ja'));assert.equal(meta.bytes,310);assert.equal(meta.license,'apache-2.0');assert.equal(meta.revision,'a'.repeat(40));
   fixture.cardData.license='unknown-license';const rejection=await page.evaluate(async()=>{try{await LocalTranslation.inspect('ja','en');return null;}catch(e){return e.message;}});assert.match(rejection,/利用許諾/);
   const pair=await page.evaluate(async()=>{try{await LocalTranslation.inspect('fr','ja');return null;}catch(e){return e.message;}});assert.match(pair,/日本語/);
   await page.unroute('https://huggingface.co/**');
  });
  await test('Manual prompt copy and import: no automatic external service',async()=>{
   await page.check('#save-history');await page.fill('#source-text','=HYPERLINK("https://example.com")');await page.click('[data-page=services]');await page.selectOption('#manual-style','polite');await page.click('#copy-prompt');await page.waitForFunction(()=>window.__copied?.includes('丁寧な表現'));assert.match(await page.inputValue('#prompt-preview'),/HYPERLINK/);await page.fill('#manual-model','Webモデル（自己申告）');await page.fill('#manual-result','<script>alert(1)</script> 手動の訳文');await page.click('#import-manual');assert.match(await page.locator('#comparison-list').innerText(),/手動取り込み/);assert.equal(await page.locator('#comparison-list script').count(),0);assert.match(await page.locator('#comparison-list').innerText(),/未検証/);assert.deepEqual(apiCalls,[]);
  });
  await test('History favorite, comparison selection, JSON/CSV with formula protection',async()=>{
   await page.click('[data-page=history]');await page.waitForSelector('#history-list .history-card');await page.locator('#history-list').getByRole('button',{name:'☆ お気に入り',exact:true}).click();await page.waitForFunction(()=>document.getElementById('history-list').textContent.includes('★ お気に入り済み'));
   let downloadPromise=page.waitForEvent('download');await page.click('#export-json');let download=await downloadPromise;let payload=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(payload.records.length,1);assert.equal(payload.records[0].isFavorite,true);
   downloadPromise=page.waitForEvent('download');await page.click('#export-csv');download=await downloadPromise;const csv=fs.readFileSync(await download.path(),'utf8');assert.match(csv,/'=HYPERLINK/);assert.match(csv,/手動の訳文/);await page.locator('#history-list').getByRole('button',{name:'比較に追加',exact:true}).click();assert.match(await page.locator('#comparison-list').innerText(),/Webモデル/);
  });
  await test('Import validates all entries, never overwrites old history, distrusts model provenance',async()=>{
   await page.click('[data-page=history]');const old={original:'既存と異なる文',translated:'imported',from:'en',to:'ja',createdAt:100,manual:false,model:'self-asserted'};
   await page.setInputFiles('#import-history',{name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([old,{original:4}]))});await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('不正'));assert.equal(await page.locator('#history-list .history-card').count(),1);
   page.once('dialog',d=>d.accept());await page.setInputFiles('#import-history',{name:'good.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([old]))});await page.waitForFunction(()=>document.querySelectorAll('#history-list .history-card').length===2);assert.match(await page.locator('#history-list').innerText(),/手動取り込み/);
   const rows=await page.evaluate(()=>historyOperation('readonly',s=>s.getAll()));assert.equal(rows.length,2);assert.equal(rows.find(r=>r.original===old.original).manual,true);assert.equal(rows[0].isFavorite,true);
  });
  await test('Empty exports are valid; clearing comparison never deletes history',async()=>{
   await page.click('[data-page=compare]');await page.click('#clear-comparison');assert.match(await page.locator('#comparison-list').innerText(),/まだありません/);assert.equal((await page.evaluate(()=>historyOperation('readonly',s=>s.getAll()))).length,2);
   await page.click('[data-page=history]');page.once('dialog',d=>d.accept());await page.click('#delete-all');await page.waitForFunction(()=>!document.querySelector('#history-list .history-card'));
   const waiting=page.waitForEvent('download');await page.click('#export-json');const download=await waiting;assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')).records,[]);
  });
  assert.deepEqual(errors,[]);console.log(`${passed} new features passed. No mocked translation was counted as real inference.`);await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
