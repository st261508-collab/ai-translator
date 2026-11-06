// ONLY real models. No mock AI, tokenizer, worker, translation or model bytes.
const {execFileSync}=require('node:child_process');const assert=require('node:assert/strict');const {chromium,devices}=require('playwright');
(async()=>{
 try{execFileSync('curl',['-fsSL','--max-time','30','https://huggingface.co/api/models/Xenova/opus-mt-en-jap?blobs=true'],{stdio:['ignore','pipe','pipe']});}
 catch(error){console.error('BLOCKED / NOT RUN: Real translation model download is not accessible. '+(error.stderr?.toString().trim()||error.message));process.exitCode=2;return;}
 const proxy=process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}:undefined;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy});
 try{const context=await browser.newContext({...devices['iPhone 13']});const page=await context.newPage();page.setDefaultTimeout(600000);page.on('dialog',d=>d.accept());await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:4173/ai-translator/');await page.selectOption('#translation-model','transformers');
  for(const [from,text,expected]of [['en','Hello, how are you?',/こんにちは|元気|調子/],['ja','私は猫が好きです。',/cat/i]]){
   await page.click('#open-settings');await page.selectOption('#source-language',from);await page.selectOption('#foreign-language','en');await page.locator('#settings .primary').click();await page.fill('#source-text',text);await page.click('#translate');
   await page.waitForFunction(()=>!document.getElementById('translate').disabled,{},{timeout:600000});
   assert.equal(await page.locator('#translation-error').isVisible(),false,await page.locator('#translation-error').textContent());const result=await page.locator('#result').innerText();console.log(`REAL OPUS-MT ${from}: ${result}`);assert.match(result,expected);assert.doesNotMatch(result,/TEST ONLY|mock/i);
   const meta=await page.evaluate(from=>LocalTranslation.cachedMeta(from,from==='en'?'ja':'en'),from);console.log(JSON.stringify(meta));
  }
  console.log('PASS real bidirectional Japanese/English WASM inference in Chromium. Physical iPhone Safari NOT tested.');await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
