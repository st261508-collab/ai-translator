// New workflow tests. All mocked APIs/clipboard values exist only in this test.
const assert = require('node:assert/strict');
const {chromium,devices} = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/ai-translator/';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});let count=0;
 const check=async(name,fn)=>{await fn();console.log('PASS '+name);count++;};
 try{
  const ctx=await browser.newContext({...devices['iPhone 13'],defaultBrowserType:undefined});
  const page=await ctx.newPage(),errors=[],outbound=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(new URL(BASE).origin))outbound.push(r.url());});
  await ctx.addInitScript(()=>{
   window.Translator=undefined;window.LanguageDetector=undefined;
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{if(window.__deny)throw Error('permission denied');if(window.__defer)return new Promise(resolve=>window.__resolveClipboard=resolve);return window.__clip||'';},writeText:async()=>{}}});
  });
  await page.goto(BASE);
  await check('Compact iPhone viewport: input visible immediately, correct control order',async()=>{
   const input=await page.locator('#source-text').boundingBox();assert(input.y+input.height<650);assert.equal(await page.locator('.intro').count(),0);
   const y=await page.locator('#translation-model').boundingBox(),run=await page.locator('#translate').boundingBox(),result=await page.locator('#result').boundingBox();assert(input.y<y.y&&y.y<run.y&&run.y<result.y);
   for(const width of [320,375,390,430]){await page.setViewportSize({width,height:844});for(const section of ['translate','models','images','services','history']){await page.click(`[data-page=${section}]`);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${section}`);}}
   await page.setViewportSize({width:390,height:844});await page.click('[data-page=translate]');await page.screenshot({path:'/tmp/kotoba-compact-mobile.png',fullPage:true});
  });
  await check('Paste denial, empty clipboard and pending edits preserve input',async()=>{
   await page.fill('#source-text','入力中の文章');await page.evaluate(()=>window.__deny=true);await page.click('#paste');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('許可'));assert.equal(await page.inputValue('#source-text'),'入力中の文章');
   await page.evaluate(()=>{window.__deny=false;window.__clip='';});await page.click('#paste');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('文章がありません'));assert.equal(await page.inputValue('#source-text'),'入力中の文章');
   await page.evaluate(()=>window.__defer=true);await page.click('#paste');await page.fill('#source-text','新しい入力');await page.evaluate(()=>{window.__resolveClipboard('古い貼り付け');window.__defer=false;});await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('入力が変わった'));assert.equal(await page.inputValue('#source-text'),'新しい入力');
  });
  await check('Auto-paste setting persists; unsupported engine never translates',async()=>{
   await page.click('#open-settings');assert.equal(await page.locator('#auto-translate-paste').isChecked(),false);await page.check('#auto-translate-paste');await page.locator('#settings .primary').click();await page.evaluate(()=>window.__clip='hello');await page.click('#paste');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('自動翻訳は実行しません'));assert.equal(await page.inputValue('#source-text'),'hello');assert(await page.locator('#copy').isDisabled());await page.reload();await page.click('#open-settings');assert(await page.locator('#auto-translate-paste').isChecked());await page.locator('#settings .primary').click();
  });
  await check('Reasoning: five visible levels, only supported auto selectable',async()=>{
   for(const id of ['reasoning-level','settings-reasoning']){assert.deepEqual(await page.locator(`#${id} option`).allTextContents(),['自動','低','標準','高','最大']);assert.equal(await page.locator(`#${id} option:not([disabled])`).count(),1);assert.equal(await page.locator(`#${id}`).inputValue(),'auto');}
  });
  await check('All requested candidates are disconnected; no invented API IDs',async()=>{
   await page.click('[data-page=models]');assert.equal(await page.locator('.model-card').count(),10);for(const name of ['GPT-6 Astra','GPT-6 Sol','GPT-6 Terra','GPT-6 Luna','Gemini 3.5 Flash-Lite','Claude Sonnet 5.5','Claude Haiku 5.5','Qwen 3.8 Max']){const card=page.locator('.model-card').filter({has:page.getByRole('heading',{name,exact:true})});assert.match(await card.innerText(),/未接続/);assert(await card.locator('input').isDisabled());}
   const ids=await page.evaluate(()=>KotobaModels.catalog.map(m=>m.apiModelId));assert(ids.every(id=>id===null));
   assert(await page.evaluate(()=>{const result=KotobaModels.withProviderMetadata('openai',[{candidateKey:'gpt6-astra',id:'test-official-id',reasoningMap:{low:'test-low',bogus:'ignore'}}]).find(m=>m.id==='gpt6-astra');return result.apiModelId==='test-official-id'&&!result.connected&&result.reasoning.length===1&&result.reasoning[0]==='low';}));
  });
  await check('Search, favorite, pin, name sorting and custom order persist',async()=>{
   await page.fill('#model-search','Claude');assert.equal(await page.locator('.model-card').count(),2);await page.fill('#model-search','not-found');assert.match(await page.locator('#model-list').innerText(),/一致するモデルがありません/);await page.fill('#model-search','');
   await page.getByRole('button',{name:'Qwen 3.8 Max：お気に入り',exact:true}).click();await page.getByRole('button',{name:'Qwen 3.8 Max：ピン留め',exact:true}).click();assert.equal(await page.locator('.model-card').first().getAttribute('data-model-id'),'qwen-max');
   await page.selectOption('#model-sort','name');const names=await page.locator('.model-card h3').allTextContents();assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b,'ja')));
   await page.selectOption('#model-sort','custom');await page.getByRole('button',{name:'Chrome Translator：下へ',exact:true}).click();assert.equal(await page.locator('.model-card').first().getAttribute('data-model-id'),'transformers');await page.reload();await page.click('[data-page=models]');assert.equal(await page.locator('#model-sort').inputValue(),'custom');assert.equal(await page.locator('.model-card').first().getAttribute('data-model-id'),'transformers');assert.equal(await page.getByRole('button',{name:'Qwen 3.8 Max：お気に入り',exact:true}).getAttribute('aria-pressed'),'true');
  });
  await check('Image modes cannot run; official links separated with safety notes',async()=>{
   await page.click('[data-page=images]');assert.equal(await page.locator('[name=image-mode]:disabled').count(),2);assert.match(await page.locator('#image-modes').innerText(),/未接続・利用条件の確認が必要/);await page.click('[data-page=services]');assert.match(await page.locator('#page-services').innerText(),/年齢条件/);for(const link of await page.locator('.service-links a').all()){assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);}assert.deepEqual(outbound,[]);
  });
  await check('Auto translation runs only on available local engine; no download prompt',async()=>{
   await page.click('[data-page=translate]');await page.click('#open-settings');await page.selectOption('#source-language','en');await page.locator('#settings .primary').click();
   await page.evaluate(()=>{window.__clip='hello auto';window.Translator={availability:async()=>window.__status||'available',create:async()=>({translate:async text=>{window.__calls=(window.__calls||0)+1;return '[TEST ONLY] '+text;},destroy:()=>{}})};});
   await page.click('#paste');await page.waitForFunction(()=>!document.getElementById('copy').disabled);assert.match(await page.locator('#result').innerText(),/hello auto/);assert.equal(await page.evaluate(()=>window.__calls),1);
   await page.evaluate(()=>{window.__status='unavailable';window.__clip='unavailable';});await page.click('#paste');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('利用できません'));assert.equal(await page.evaluate(()=>window.__calls),1);assert.equal(await page.inputValue('#source-text'),'unavailable');
   let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});await page.evaluate(()=>{window.__status='downloadable';window.__clip='download';});await page.click('#paste');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('モデル取得'));assert.equal(dialogs,0);assert.equal(await page.evaluate(()=>window.__calls),1);
  });
  assert.deepEqual(errors,[]);console.log(`${count} new workflow checks passed in Chromium mobile emulation. Not physical Safari.`);await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
