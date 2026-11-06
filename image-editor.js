'use strict';
let imageGeneration=0, ocrWorker=null, sourceCanvas=null, outputURL=null, renderGeneration=0;
function resetImageEditor(){imageGeneration++;ocrWorker?.terminate().catch(()=>{});ocrWorker=null;sourceCanvas=null;$('image-tools').hidden=true;$('ocr-text').value='';$('overlay-text').value='';$('ocr-status').textContent='';$('run-ocr').disabled=false;$('save-image').removeAttribute('href');if(outputURL)URL.revokeObjectURL(outputURL);outputURL=null;}
addEventListener('kotoba-image-clear',resetImageEditor);
$('preview').addEventListener('load',()=>{
 if(!$('preview').getAttribute('src'))return;
 const img=$('preview');if(img.naturalWidth*img.naturalHeight>20000000){toast('画像の画素数が大きすぎます。20メガピクセル以下に縮小してください。');return;}
 sourceCanvas=document.createElement('canvas');const ratio=Math.min(1,1600/img.naturalWidth,1600/img.naturalHeight);sourceCanvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));sourceCanvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));sourceCanvas.getContext('2d').drawImage(img,0,0,sourceCanvas.width,sourceCanvas.height);
 $('image-tools').hidden=false;$('overlay-size').value=Math.max(16,Math.round(sourceCanvas.width/25));drawOverlay();
});
function wrappedLines(context,text,width){const lines=[];for(const paragraph of text.split('\n')){let current='';for(const c of paragraph){if(context.measureText(current+c).width>width&&current){lines.push(current);current=c;}else current+=c;}lines.push(current);}return lines;}
function drawOverlay(){
 if(!sourceCanvas)return;const canvas=$('image-canvas');canvas.width=sourceCanvas.width;canvas.height=sourceCanvas.height;const ctx=canvas.getContext('2d');ctx.drawImage(sourceCanvas,0,0);
 const size=Math.max(8,Math.min(200,Number($('overlay-size').value)||32)),x=canvas.width*Number($('overlay-x').value)/100,y=canvas.height*Number($('overlay-y').value)/100;
 ctx.font=`${size}px -apple-system, sans-serif`;ctx.textBaseline='top';const lines=wrappedLines(ctx,$('overlay-text').value,Math.max(size,canvas.width-x-10));
 if($('overlay-text').value){if($('overlay-background').checked){ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillRect(Math.max(0,x-4),Math.max(0,y-4),canvas.width-x,lines.length*size*1.4+8);}ctx.fillStyle=$('overlay-color').value;lines.forEach((line,index)=>ctx.fillText(line,x,y+index*size*1.4));}
 $('overlay-warning').textContent=y+lines.length*size*1.4>canvas.height?'訳文が画像の下にはみ出しています。位置や文字サイズを調整してください。':'';
 const ticket=++renderGeneration;canvas.toBlob(blob=>{if(ticket!==renderGeneration||!blob||!sourceCanvas)return;if(outputURL)URL.revokeObjectURL(outputURL);outputURL=URL.createObjectURL(blob);$('save-image').href=outputURL;},'image/png');
}
for(const id of ['overlay-text','overlay-x','overlay-y','overlay-size','overlay-color','overlay-background'])$(id).addEventListener('input',drawOverlay);
$('run-ocr').addEventListener('click',async()=>{
 if(!sourceCanvas||ocrWorker)return;const generation=imageGeneration;let currentWorker=null;$('run-ocr').disabled=true;
 try{
  if(!confirm('無料のTesseract OCRを端末で実行します。初回は同じサイトからOCR本体約4MB＋英語約4MB／日本語約2.5MBを読み込みます。画像の外部送信はしません。続けますか？'))return;
  $('ocr-status').textContent='OCRを準備しています…';
  const worker=await Tesseract.createWorker($('ocr-language').value,Tesseract.OEM.LSTM_ONLY,{
   workerPath:new URL('./vendor/tesseract/worker.min.js',document.baseURI).href,corePath:new URL('./vendor/tesseract/core/',document.baseURI).href,langPath:new URL('./vendor/tesseract/lang/',document.baseURI).href,gzip:false,workerBlobURL:false,
   logger:progress=>{if(generation===imageGeneration)$('ocr-status').textContent=`OCR：${progress.status} ${Math.round((progress.progress||0)*100)}%`;}
  });
  currentWorker=worker;if(generation!==imageGeneration)return;ocrWorker=worker;
  const {data}=await worker.recognize(sourceCanvas,{}, {text:true,blocks:true});
  if(generation!==imageGeneration)return;
  $('ocr-text').value=(data.text||'').slice(0,5000);
  $('ocr-status').textContent=data.text?.trim()?`文字を読み取りました。信頼度 ${Math.round(data.confidence)}%（正確さの保証ではありません）。内容を確認・編集してください。`:'文字を検出できませんでした。言語・解像度・明るさを確認するか、文章を手入力してください。';
  const bbox=data.blocks?.find(block=>block.text?.trim())?.bbox;
  if(bbox){$('overlay-x').value=Math.min(90,Math.round(100*bbox.x0/sourceCanvas.width));$('overlay-y').value=Math.min(90,Math.round(100*bbox.y0/sourceCanvas.height));}
 }catch(error){if(generation===imageGeneration)$('ocr-status').textContent=`OCRに失敗しました：${error.message}。初回はオンラインで開き、空きメモリをご確認ください。`;}finally{await currentWorker?.terminate().catch(()=>{});if(ocrWorker===currentWorker)ocrWorker=null;if(generation===imageGeneration)$('run-ocr').disabled=false;}
});
$('translate-ocr').addEventListener('click',()=>{
 if(!$('ocr-text').value.trim()){toast('認識した文字を確認・入力してください。');return;}
 $('source-text').value=$('ocr-text').value.slice(0,5000);sourceLang=$('ocr-language').value==='eng'?'en':'ja';foreignLang='en';$('source-language').value=sourceLang;$('foreign-language').value=foreignLang;writePref('kp-settings',{source:sourceLang,foreign:foreignLang});$('source-text').dispatchEvent(new Event('input'));updateLabels();showPage('translate');runTranslation();
});
$('result-to-image').addEventListener('click',()=>{if(!sourceCanvas){toast('先に画像画面で元画像を選択してください。');return;}$('overlay-text').value=resultText;drawOverlay();showPage('images');});
