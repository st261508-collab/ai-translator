// Deterministic mock translations below are test doubles, never production output.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/ai-translator/';
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 let count=0;
 const check=async(name,fn)=>{await fn();console.log('PASS '+name);count++;};
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
  await context.addInitScript(()=>{if(sessionStorage.getItem('test-mock'))return;Object.defineProperty(window,'Translator',{value:undefined,writable:true,configurable:true});Object.defineProperty(window,'LanguageDetector',{value:undefined,writable:true,configurable:true});});
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE);
  await check('Unsupported API: explicit notice and no fabricated result',async()=>{assert.match(await page.locator('#capability').innerText(),/翻訳できません/);assert(await page.locator('#translate').isDisabled());assert.match(await page.locator('#result').innerText(),/ここに翻訳結果/);});
  await check('390px mobile layout',async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));});
  await check('Settings, theme, favorites and pin persist',async()=>{
   await page.click('#open-settings');await page.selectOption('#source-language','ja');await page.selectOption('#foreign-language','fr');await page.locator('#settings .primary').click();await page.click('#theme-toggle');
   await page.click('[data-page=models]');await page.getByRole('button',{name:'Transformers.js：お気に入り',exact:true}).click();await page.getByRole('button',{name:'Transformers.js：ピン留め',exact:true}).click();await page.reload();assert.equal(await page.locator('#target-label').innerText(),'フランス語');await page.click('[data-page=models]');assert.match(await page.locator('.model-card').first().innerText(),/Transformers.js/);assert(await page.locator('input[value=chrome]').isChecked());assert(await page.locator('input[value=transformers]').isDisabled());assert.equal(await page.getByRole('button',{name:'Transformers.js：お気に入り',exact:true}).getAttribute('aria-pressed'),'true');
  });
  await check('Image preview, removal and invalid type',async()=>{
   await page.click('[data-page=images]');await page.setInputFiles('#image-file',{name:'icon.png',mimeType:'image/png',buffer:require('node:fs').readFileSync('icons/icon-192.png')});await page.waitForSelector('#image-preview:not([hidden])');assert.match(await page.locator('#image-name').innerText(),/未実装/);await page.click('#remove-image');assert(await page.locator('#image-preview').isHidden());await page.setInputFiles('#image-file',{name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});assert(await page.locator('#image-preview').isHidden());assert.match(await page.locator('#toast').innerText(),/10MB以下/);
  });
  await check('Clipboard paste, length limit, opt-in history',async()=>{await page.click('[data-page=translate]');await page.evaluate(()=>navigator.clipboard.writeText('a'.repeat(5001)));await page.click('#paste');await page.waitForFunction(()=>document.getElementById('source-text').value.length===5000);assert.equal((await page.inputValue('#source-text')).length,5000);assert.equal(await page.locator('#save-history').isChecked(),false);});
  // Inject only into this browser test. Production contains no translation mocks.
  await page.evaluate(()=>sessionStorage.setItem('test-mock','true'));
  await context.addInitScript(()=>{
   if(!sessionStorage.getItem('test-mock'))return;
   window.Translator={availability:async()=>window.__availability||'available',create:async pair=>({translate:async text=>{window.__pair=pair;if(window.__delay)await new Promise(r=>setTimeout(r,350));if(window.__fail)throw Error('テスト用エラー');return '[TEST ONLY] '+text;},destroy:()=>{}})};
   window.LanguageDetector={availability:async()=>'available',create:async()=>({detect:async()=>[{detectedLanguage:'en',confidence:.99}],destroy:()=>{}})};
  });
  await page.reload();
  await page.click('#open-settings');await page.selectOption('#source-language','auto');await page.locator('#settings .primary').click();
  await check('Adapter: foreign → Japanese, safe rendering, copy, history and reuse',async()=>{
   await page.check('#save-history');await page.fill('#source-text','<img src=x onerror=alert(1)> hello');await page.click('#translate');await page.waitForFunction(()=>!document.getElementById('copy').disabled);assert.deepEqual(await page.evaluate(()=>window.__pair),{sourceLanguage:'en',targetLanguage:'ja'});assert.equal(await page.locator('#result img').count(),0);await page.click('#copy');assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/TEST ONLY/);
   await page.click('[data-page=history]');await page.waitForSelector('.history-card');assert.equal(await page.locator('.history-card img').count(),0);await page.fill('#history-search','no-match');await page.waitForFunction(()=>document.getElementById('history-list').textContent.includes('一致する履歴'));await page.fill('#history-search','hello');await page.waitForSelector('.history-card');await page.getByRole('button',{name:'再利用',exact:true}).click();assert.match(await page.inputValue('#source-text'),/hello/);assert(await page.locator('#copy').isDisabled());
  });
  await check('Adapter: Japanese → selected foreign language',async()=>{await page.click('#open-settings');await page.selectOption('#source-language','ja');await page.locator('#settings .primary').click();await page.fill('#source-text','こんにちは');await page.click('#translate');await page.waitForFunction(()=>!document.getElementById('copy').disabled);assert.deepEqual(await page.evaluate(()=>window.__pair),{sourceLanguage:'ja',targetLanguage:'fr'});});
  await check('Failed translation clears result and never saves history',async()=>{await page.evaluate(()=>window.__fail=true);await page.fill('#source-text','failure');await page.click('#translate');await page.waitForFunction(()=>document.getElementById('result-note').textContent.includes('完了していません'));assert(await page.locator('#copy').isDisabled());await page.click('[data-page=history]');await page.fill('#history-search','');await page.waitForFunction(()=>document.querySelectorAll('.history-card').length===2);await page.click('[data-page=translate]');await page.evaluate(()=>window.__fail=false);});
  await check('Unavailable pair and cancelled download do not succeed',async()=>{await page.evaluate(()=>window.__availability='unavailable');await page.click('#translate');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('利用できません'));assert(await page.locator('#copy').isDisabled());await page.evaluate(()=>window.__availability='downloadable');page.once('dialog',d=>d.dismiss());await page.click('#translate');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('中止'));assert(await page.locator('#copy').isDisabled());await page.evaluate(()=>window.__availability='available');});
  await check('Editing during a request discards stale results',async()=>{await page.evaluate(()=>window.__delay=true);await page.fill('#source-text','old');await page.click('#translate');await page.fill('#source-text','new');await page.waitForFunction(()=>!document.getElementById('translate').disabled);assert(await page.locator('#copy').isDisabled());});
  await check('Single deletion and clear all',async()=>{await page.click('[data-page=history]');await page.waitForSelector('.history-card');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'この履歴を削除',exact:true}).first().click();await page.waitForFunction(()=>document.querySelectorAll('.history-card').length===1);page.once('dialog',d=>d.accept());await page.click('#delete-all');await page.waitForFunction(()=>document.querySelectorAll('.history-card').length===0);});
  await check('Chromebook layout',async()=>{await page.setViewportSize({width:1366,height:768});await page.click('[data-page=translate]');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/kotoba-desktop.png',fullPage:true});});
  await check('PWA assets, repository scope, offline reload',async()=>{const m=await(await page.request.get(BASE+'manifest.webmanifest')).json();assert.equal(m.start_url,'./');for(const icon of m.icons)assert.equal((await page.request.get(new URL(icon.src,BASE).href)).status(),200);await page.evaluate(async()=>{await navigator.serviceWorker.ready});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);assert.match(await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL),/\/ai-translator\/sw.js$/);await context.setOffline(true);await page.reload();await page.waitForSelector('#source-text');await context.setOffline(false);});
  assert.deepEqual(errors,[]);console.log(`${count} checks passed. Real translation quality and physical iPhone Safari are untested.`);
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
