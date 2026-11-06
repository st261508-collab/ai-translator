// Runs real Tesseract WASM and real English/Japanese traineddata, with no mock OCR.
const assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const page=await browser.newPage();page.setDefaultTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:4173/ai-translator/');await page.click('[data-page=images]');
  for(const [language,text,expected]of [['eng','Hello world',/Hello\s+world/i],['jpn','こんにちは世界',/こんにちは/]]){
   const png=await page.evaluate(async text=>{await document.fonts.ready;const c=document.createElement('canvas');c.width=1000;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';ctx.font='64px "Noto Sans CJK JP", sans-serif';ctx.fillText(text,40,140);return c.toDataURL().split(',')[1];},text);
   await page.setInputFiles('#image-file',{name:language+'.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForSelector('#image-tools:not([hidden])');await page.selectOption('#ocr-language',language);page.once('dialog',d=>d.accept());await page.click('#run-ocr');await page.waitForFunction(()=>!document.getElementById('run-ocr').disabled,{},{timeout:120000});
   const recognized=await page.inputValue('#ocr-text');console.log(language,'REAL OCR:',recognized.trim());assert.match(recognized,expected);await page.fill('#overlay-text',language==='eng'?'こんにちは':'Hello');await page.fill('#overlay-size','42');await page.waitForFunction(()=>document.getElementById('save-image').href.startsWith('blob:'));assert(await page.evaluate(()=>document.getElementById('image-canvas').width>0));
  }
  assert.deepEqual(errors,[]);console.log('PASS real English and Japanese OCR + editable PNG overlay export');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
