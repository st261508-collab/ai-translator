'use strict';
const CACHE='kotoba-pocket-shell-v3';
const RUNTIME='kotoba-pocket-runtime-v3';
const SHELL=['./','./index.html','./style.css?v=3','./script.js?v=3','./local-engine.js?v=3','./model-registry.js?v=3','./enhancements.js?v=3','./image-editor.js?v=3','./vendor/tesseract/tesseract.min.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'];
const LAZY=['./local-worker.js','./vendor/transformers/transformers.min.js','./vendor/transformers/ort-wasm-simd-threaded.jsep.mjs','./vendor/transformers/ort-wasm-simd-threaded.jsep.wasm','./vendor/transformers/ort.bundle.min.mjs','./vendor/tesseract/worker.min.js','./vendor/tesseract/core/tesseract-core-lstm.wasm.js','./vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js','./vendor/tesseract/lang/eng.traineddata','./vendor/tesseract/lang/jpn.traineddata'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('kotoba-pocket-shell-')||key.startsWith('kotoba-pocket-runtime-'))&&key!==CACHE&&key!==RUNTIME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 const resolve=path=>new URL(path,self.registration.scope).href;
 if(event.request.mode==='navigate'&&url.pathname.startsWith(new URL(self.registration.scope).pathname)){
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(resolve('./index.html'))).then(cached=>cached||fetch(event.request)));return;
 }
 const isShell=SHELL.map(resolve).includes(url.href),isLazy=LAZY.map(resolve).includes(url.href);if(!isShell&&!isLazy)return;
 event.respondWith(caches.open(isShell?CACHE:RUNTIME).then(async cache=>{
  const cached=await cache.match(event.request);if(cached)return cached;
  const response=await fetch(event.request);if(response.ok){try{await cache.put(event.request,response.clone());}catch{/* Cache quota must not prevent using a successful download. */}}return response;
 }));
});
