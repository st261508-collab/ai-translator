import { pipeline, env } from './vendor/transformers/transformers.min.js';
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/transformers/', import.meta.url).href;
let translator, loadedKey;
const send = (id,type,data) => self.postMessage({id,type,...data});
self.onmessage = async ({data:{id,meta,text}}) => {
  try {
    const key = `${meta.repo}@${meta.revision}`;
    if (key !== loadedKey) {
      await translator?.dispose(); translator = null; loadedKey = null;
      translator = await pipeline('translation',meta.repo,{
        revision:meta.revision,device:'wasm',dtype:'q8',
        progress_callback:progress => send(id,'progress',{progress})
      });
      loadedKey = key;
    }
    // Conservative chunks avoid silently truncating long input at a model's token limit.
    const sentences = text.split(/(?<=[。！？.!?])\s+|\n+/u).filter(Boolean);
    const chunks = sentences.flatMap(s => Array.from(s).reduce((list,c,i) => { if(i%180===0)list.push('');list[list.length-1]+=c;return list; },[]));
    const result=[];
    for (let i=0;i<chunks.length;i++) {
      send(id,'progress',{progress:{status:'inference',done:i,total:chunks.length}});
      const output=await translator(chunks[i],{max_new_tokens:256,num_beams:1});
      const translated=output[0]?.translation_text;
      if(typeof translated!=='string'||!translated.trim())throw Error('モデルが空の結果を返しました。');
      result.push(translated);
    }
    send(id,'result',{text:result.join('\n')});
  } catch(error) { send(id,'error',{message:String(error.message || error)}); }
};
