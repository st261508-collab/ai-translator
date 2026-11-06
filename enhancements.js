'use strict';
const comparisonRecords=[];
let manualContext=null;
const styleNames={natural:'自然な翻訳',literal:'直訳',polite:'丁寧な表現'};
const rememberedStyle=readPref('kp-translation-style','natural');
$('translation-style').value=Object.hasOwn(styleNames,rememberedStyle)?rememberedStyle:'natural';
// No instruction-following engine is connected. Retain preference without pretending it applies.
$('translation-style').disabled=true;
$('manual-style').value=$('translation-style').value;
$('manual-style').addEventListener('change',()=>{writePref('kp-translation-style',$('manual-style').value);$('translation-style').value=$('manual-style').value;});
function networkStatus(){ $('network-status').textContent=navigator.onLine?'オンライン（モデル取得には通信が必要です）':'オフライン：取得済みモデルと履歴を使えます。ブラウザがキャッシュを削除した場合は再取得が必要です。'; }
addEventListener('online',networkStatus);addEventListener('offline',networkStatus);networkStatus();
function showLastUsed(){const last=readPref('kp-last-used',null);$('last-used-note').textContent=last&&typeof last.model==='string'?`最後に使用：${last.model} · ${last.manual?'外部Webから手動取り込み':'端末内翻訳'}`:'まだ翻訳を使用していません。';}
showLastUsed();
function comparisonKey(record){return JSON.stringify([record.original,record.from,record.to]);}
function renderComparison(){
 const previous=$('compare-source').value;
 const groups=new Map();for(const record of comparisonRecords)groups.set(comparisonKey(record),record);
 $('compare-source').replaceChildren();
 for(const [key,record]of groups)$('compare-source').add(new Option(`${record.original.slice(0,55)} (${record.from}→${record.to})`,key));
 if(groups.has(previous))$('compare-source').value=previous;
 $('comparison-list').replaceChildren();
 const current=comparisonRecords.filter(r=>comparisonKey(r)===$('compare-source').value);
 if(!current.length)$('comparison-list').append(element('p','比較する結果はまだありません。成功した翻訳、履歴、手動取り込みから追加できます。','empty'));
 for(const record of current){const card=element('article',undefined,'history-card');card.append(element('h3',record.model||'モデル未記録'),element('p',`${record.manual?'手動取り込み（自己申告・モデル未検証）':record.method==='local'?'端末内モデルによる自動翻訳':'旧記録・方式不明'} · ${new Date(record.createdAt).toLocaleString('ja-JP')} · ${record.from}→${record.to}`,'muted'),element('p',record.translated),element('p',record.manual?'翻訳スタイルの適用は未検証':'スタイル：モデル標準（指示変更なし）','muted'));$('comparison-list').append(card);}
}
addEventListener('kotoba-result',({detail})=>{if(!comparisonRecords.some(r=>r.original===detail.original&&r.translated===detail.translated&&r.createdAt===detail.createdAt&&r.model===detail.model))comparisonRecords.push({...detail});renderComparison();$('compare-source').value=comparisonKey(detail);renderComparison();});
$('compare-source').addEventListener('change',renderComparison);
$('clear-comparison').addEventListener('click',()=>{comparisonRecords.length=0;renderComparison();});
$('compare-local').addEventListener('click',async()=>{
 if(busy){toast('翻訳中です。完了してからお試しください。');return;}
 const original=$('source-text').value,from=sourceLang,to=foreignLang;
 if(!original.trim()){toast('テキスト画面に原文を入力してください。');showPage('translate');return;}
 $('compare-local').disabled=true;
 try{for(const model of modelCatalog.filter(m=>m.connected&&engines[m.id])){
  if($('source-text').value!==original||sourceLang!==from||foreignLang!==to){toast('原文・設定が変わったため比較翻訳を止めました。');break;}
  await runTranslation({modelId:model.id});
 }}finally{$('compare-local').disabled=false;}
});
$('copy-prompt').addEventListener('click',async()=>{
 manualContext=null;$('prompt-preview').hidden=true;
 try{
  const original=$('source-text').value.trim();if(!original)throw Error('テキスト画面に原文を入力してください。');
  const from=sourceLang==='auto'?await detectLanguage(original):sourceLang,to=from==='ja'?foreignLang:'ja',style=$('manual-style').value;
  manualContext={original,from,to,style,service:$('manual-service').value};
  const prompt=`次の文章を${LANGUAGES[from]||from}から${LANGUAGES[to]||to}へ翻訳してください。指定：${styleNames[style]}。原文の意味を保ち、翻訳文だけを返してください。\n---\n${original}`;
  $('prompt-preview').value=prompt;$('prompt-preview').hidden=false;
  $('manual-context').textContent=`取り込み対象：${original.slice(0,60)} · ${from}→${to} · ${manualContext.service}。以下の指示を公式サイトへ手動で貼り付けてください。`;
  await navigator.clipboard.writeText(prompt);toast('原文と指示をコピーしました。条件を満たす公式サイトを開いてください。');
 }catch(error){toast(error.message+' コピーできない場合は下の指示欄を選択してコピーしてください。');}
});
$('import-manual').addEventListener('click',async()=>{
 const translated=$('manual-result').value.trim();
 if(!manualContext){toast('まず「原文と翻訳指示をコピー」で対象の原文を確定してください。');return;}
 if(!translated){toast('公式サイトの訳文をご自身で貼り付けてください。');return;}
 const record={original:manualContext.original,translated,from:manualContext.from,to:manualContext.to,style:manualContext.style,styleVerified:false,model:$('manual-model').value.trim()||`${manualContext.service}（モデル不明）`,method:'external-web-manual',manual:true,createdAt:Date.now()};
 writePref('kp-last-used',{model:record.model,manual:true});showLastUsed();dispatchEvent(new CustomEvent('kotoba-result',{detail:record}));
 if($('save-history').checked){try{await saveRecord(record);toast('手動取り込みとして履歴に保存しました。');}catch{toast('比較に追加しましたが、履歴を保存できませんでした。');}}else toast('手動取り込みとして比較に追加しました。履歴保存はオフです。');
 showPage('compare');
});
function csvCell(value){let text=String(value??'');if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
function downloadFile(contents,type,name){const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function exportHistory(format){
 try{const records=await historyOperation('readonly',s=>s.getAll());
 if(format==='json')downloadFile(JSON.stringify({format:'kotoba-pocket',version:1,records},null,2),'application/json','kotoba-history.json');
 else {const fields=['original','translated','from','to','model','method','manual','createdAt','isFavorite','style'];const rows=[fields.map(csvCell).join(','),...records.map(record=>fields.map(key=>csvCell(record[key])).join(','))];downloadFile('\uFEFF'+rows.join('\r\n'),'text/csv;charset=utf-8','kotoba-history.csv');}
 $('export-status').textContent=`${records.length}件を書き出しました。ファイルには原文と訳文が含まれます。共有先に注意してください。`;
 }catch{toast('履歴を書き出せませんでした。ブラウザの保存設定を確認してください。');}
}
$('export-json').addEventListener('click',()=>exportHistory('json'));
$('export-csv').addEventListener('click',()=>exportHistory('csv'));
$('import-history').addEventListener('change',async()=>{
 const file=$('import-history').files[0];if(!file)return;
 try{
  if(file.size>5*1024*1024)throw Error('JSONは5MB以下にしてください。');
  const parsed=JSON.parse(await file.text());const records=Array.isArray(parsed)?parsed:parsed.format==='kotoba-pocket'&&parsed.version===1?parsed.records:null;
  if(!Array.isArray(records)||records.length>1000)throw Error('対応するJSON（最大1,000件）ではありません。');
  const clean=records.map(r=>{
   if(!r||typeof r.original!=='string'||!r.original.trim()||r.original.length>5000||typeof r.translated!=='string'||!r.translated.trim()||r.translated.length>10000||!Object.hasOwn(LANGUAGES,r.from)||!Object.hasOwn(LANGUAGES,r.to)||!Number.isFinite(r.createdAt)||!Number.isFinite(new Date(r.createdAt).getTime()))throw Error('不正な履歴が含まれます。何も取り込みませんでした。');
   // Import never claims a file is proof of model execution or provider identity.
   return {original:r.original,translated:r.translated,from:r.from,to:r.to,createdAt:r.createdAt,model:typeof r.model==='string'?r.model.slice(0,120):'モデル未記録',method:'file-import',manual:true,isFavorite:r.isFavorite===true,style:typeof r.style==='string'?r.style.slice(0,40):'unknown'};
  });
  if(!clean.length){$('export-status').textContent='0件のJSONです。履歴は変更していません。';return;}
  if(!confirm(`${clean.length}件を追加します。既存履歴は削除・上書きしません。同じファイルを再取り込みすると重複します。続けますか？`))return;
  const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('history','readwrite');for(const record of clean)tx.objectStore('history').add(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  $('export-status').textContent=`${clean.length}件を追加しました（ファイルからの手動取り込み）。`;await renderHistory();
 }catch(error){toast(error.message||'取り込みに失敗しました。既存履歴はそのままです。');}finally{$('import-history').value='';}
});
renderComparison();
