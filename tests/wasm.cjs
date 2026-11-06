// Real ONNX Runtime WASM kernel test, NOT a translation test or a mock AI.
const assert=require('node:assert/strict');const {chromium}=require('playwright');
const varint=n=>{const out=[];do{let b=n&127;n>>>=7;if(n)b|=128;out.push(b);}while(n);return out;};
const integer=(key,n)=>[...varint(key*8),...varint(n)];
const bytes=(key,raw)=>[...varint(key*8+2),...varint(raw.length),...raw];
const string=(key,text)=>bytes(key,[...Buffer.from(text)]);
const info=name=>[...string(1,name),...bytes(2,bytes(1,[...integer(1,1),...bytes(2,bytes(1,integer(1,3)))]))];
const graph=[...bytes(1,[...string(1,'X'),...string(2,'Y'),...string(4,'Identity')]),...string(2,'wasm-identity'),...bytes(11,info('X')),...bytes(12,info('Y'))];
const model=[...integer(1,8),...bytes(7,graph),...bytes(8,integer(2,13))];
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{const page=await browser.newPage();await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:4173/ai-translator/');
 const result=await page.evaluate(async model=>{const ort=await import('./vendor/transformers/ort.bundle.min.mjs');ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('./vendor/transformers/',document.baseURI).href;const session=await ort.InferenceSession.create(new Uint8Array(model),{executionProviders:['wasm']});const out=await session.run({X:new ort.Tensor('float32',new Float32Array([1,2,3]),[3])});await session.release();return Array.from(out.Y.data);},model);assert.deepEqual(result,[1,2,3]);console.log('PASS actual single-thread ONNX WASM inference, WebGPU disabled. Not a language translation test.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
