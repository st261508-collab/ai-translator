'use strict';
// Model metadata comes from the public model registry, not a paid inference API.
globalThis.LocalTranslation = (() => {
  const pairs = {
    'en-ja':{repo:'Xenova/opus-mt-en-jap',upstream:'Helsinki-NLP/opus-mt-en-jap'},
    'ja-en':{repo:'Xenova/opus-mt-ja-en',upstream:'Helsinki-NLP/opus-mt-ja-en'}
  };
  const supported = () => isSecureContext && typeof Worker==='function' && typeof WebAssembly==='object' && typeof caches==='object';
  let worker, sequence=0, pending, loadedPair, metadataAbort, cancelGeneration=0;
  const metadata=new Map();
  async function fetchInfo(repo,signal=AbortSignal.timeout(30000)) {
    const response=await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`,{credentials:'omit',signal});
    if(!response.ok)throw Error(`モデル情報を取得できません（HTTP ${response.status}）。通信制限・オフライン・配布元の状態をご確認ください。`);
    return response.json();
  }
  async function inspect(from,to,signal) {
    const pair=`${from}-${to}`, model=pairs[pair];
    if(!model)throw Error('無料WASMモデルは現在、日本語⇔英語のみ対応しています。「設定・言語」で指定してください。');
    if(metadata.has(pair))return metadata.get(pair);
    const info=await fetchInfo(model.repo,signal);
    if(!/^[a-f0-9]{40}$/.test(info.sha))throw Error('モデルの固定リビジョンを確認できません。');
    const required=['onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx'];
    const files=info.siblings || [];
    for(const name of required)if(!files.some(f=>f.rfilename===name))throw Error(`必要な量子化モデルがありません：${name}`);
    let license=info.cardData?.license;
    if(!license)license=(await fetchInfo(model.upstream,signal)).cardData?.license;
    if(!['apache-2.0','mit','cc-by-4.0'].includes(license))throw Error('モデルの利用許諾を自動確認できませんでした。公式モデルカードの確認が必要です。');
    const selected=files.filter(f=>required.includes(f.rfilename)||['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json'].includes(f.rfilename));
    const bytes=selected.reduce((n,f)=>n+(f.size||f.lfs?.size||0),0);
    const meta={...model,revision:info.sha,license,bytes,files:selected.map(f=>({name:f.rfilename,bytes:f.size||f.lfs?.size||0})),from,to};
    metadata.set(pair,meta);
    // Non-secret metadata only; model bytes live in the library's separate Cache API.
    try{localStorage.setItem(`kp-local-meta-${pair}`,JSON.stringify(meta));}catch{}
    return meta;
  }
  function cachedMeta(from,to){try{return JSON.parse(localStorage.getItem(`kp-local-meta-${from}-${to}`));}catch{return null;}}
  function cancel(){cancelGeneration++;metadataAbort?.abort();worker?.terminate();worker=null;loadedPair=null;if(pending){pending.reject(Error('翻訳を中止しました。入力と履歴はそのままです。'));pending=null;}}
  async function translate(text,from,to,{automatic=false,onProgress=()=>{},confirmDownload=()=>false}={}) {
    if(!supported())throw Error('この端末は必要なWASM・Worker・キャッシュ機能に未対応です。新しいSafariをお試しください。');
    if(pending)throw Error('端末内モデルはすでに翻訳中です。');
    const generation=cancelGeneration;
    const pair=`${from}-${to}`;
    if(automatic && loadedPair!==pair)throw Error('自動翻訳は、このページで読み込み済みのモデルのみ実行します。先に「翻訳する」を押してください。');
    let meta;
    if(!navigator.onLine){meta=cachedMeta(from,to);if(!meta)throw Error('オフラインです。初回はオンラインでモデルを取得してください。');}
    else {metadataAbort=new AbortController();const timer=setTimeout(()=>metadataAbort?.abort(),30000);try{meta=await inspect(from,to,metadataAbort.signal);}finally{clearTimeout(timer);metadataAbort=null;}}
    if(generation!==cancelGeneration)throw Error('翻訳を中止しました。');
    if(loadedPair!==pair && !automatic && !await confirmDownload(meta))throw Error('モデルの読み込みを中止しました。');
    if(generation!==cancelGeneration)throw Error('翻訳を中止しました。');
    // A fresh Worker releases the previous direction's WASM heap on constrained phones.
    if(worker && loadedPair!==pair){worker.terminate();worker=null;loadedPair=null;}
    if(!worker) {
      worker=new Worker(new URL('./local-worker.js',document.baseURI),{type:'module'});
      worker.onmessage=({data})=>{
        if(!pending||pending.id!==data.id)return;
        if(data.type==='progress'){pending.onProgress(data.progress);return;}
        const task=pending;pending=null;
        if(data.type==='result'){loadedPair=task.pair;task.resolve(data.text);}
        else {loadedPair=null;task.reject(Error(data.message+' 通信・保存容量・空きメモリを確認してください。'));}
      };
      worker.onerror=event=>{const task=pending;pending=null;worker?.terminate();worker=null;loadedPair=null;task?.reject(Error('WASMエンジンの起動に失敗しました：'+(event.message||'ブラウザ・メモリ・ファイル配信を確認してください。')));};
    }
    return new Promise((resolve,reject)=>{const id=++sequence;pending={id,pair,resolve,reject,onProgress};worker.postMessage({id,meta,text});});
  }
  return {pairs,supported,inspect,cachedMeta,translate,cancel,isLoaded:(from,to)=>loadedPair===`${from}-${to}`};
})();
