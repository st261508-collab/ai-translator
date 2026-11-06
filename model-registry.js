'use strict';
// UI keys are local identifiers, NOT provider API model IDs. No network calls here.
// Candidate names are user-requested labels; availability and official IDs are unverified.
// A future authenticated server can pass model-list responses into withProviderMetadata.
// Metadata alone never enables execution: an audited adapter and consent are also required.
globalThis.KotobaModels = (() => {
  const reasoningLevels = Object.freeze({auto:'自動',low:'低',standard:'標準',high:'高',max:'最大'});
  const candidate = (id,name,provider) => ({id,name,provider,apiModelId:null,connected:false,reasoning:[],description:'将来の正規API接続候補。公式の提供状況・モデルID・利用条件は未確認です。'});
  const catalog = [
    {id:'chrome',name:'Chrome Translator',provider:'browser',apiModelId:null,connected:typeof globalThis.Translator?.create === 'function',reasoning:[],description:'端末内の翻訳機能。ブラウザと言語の対応が必要です。思考量の調整には非対応です。'},
    {id:'transformers',name:'OPUS-MT（日英・WASM）',provider:'local',apiModelId:null,connected:LocalTranslation.supported(),reasoning:[],languages:'日本語 ⇔ 英語',description:'Transformers.jsで動く無料の翻訳専用モデル。WebGPU不要。初回に方向ごとのモデル取得が必要です。iPhone実機未検証。'},
    candidate('gpt6-astra','GPT-6 Astra','openai'),
    candidate('gpt6-sol','GPT-6 Sol','openai'),
    candidate('gpt6-terra','GPT-6 Terra','openai'),
    candidate('gpt6-luna','GPT-6 Luna','openai'),
    candidate('gemini-flash-lite','Gemini 3.5 Flash-Lite','google'),
    candidate('claude-sonnet','Claude Sonnet 5.5','anthropic'),
    candidate('claude-haiku','Claude Haiku 5.5','anthropic'),
    candidate('qwen-max','Qwen 3.8 Max','qwen')
  ];
  // records: [{candidateKey, id, displayName?, reasoningMap?}]. `id` must come
  // verbatim from the provider's official model listing, not from a UI label.
  // reasoningMap maps our UI levels to documented provider-specific values.
  function withProviderMetadata(provider, records) {
    if (!Array.isArray(records)) throw new TypeError('モデル一覧は配列で指定してください。');
    return catalog.map(model => {
      const record = records.find(r => r && r.candidateKey === model.id);
      if (model.provider !== provider || !record || typeof record.id !== 'string' || !record.id.trim()) return {...model};
      const map = Object.fromEntries(Object.entries(record.reasoningMap || {}).filter(([key,value]) => key in reasoningLevels && typeof value === 'string' && value.length));
      return {...model, apiModelId:record.id, officialDisplayName:typeof record.displayName === 'string' ? record.displayName : null, reasoning:Object.keys(map),reasoningMap:map,connected:false};
    });
  }
  const imageModes = [
    {id:'ocr-overlay',name:'A：無料OCR＋翻訳文の重ね表示',status:'無料OCR・重ね表示',kind:'local',pipeline:['detectTextWithBounds','translateText','renderOverlay'],apiModelId:null,connected:true},
    {id:'official-image',name:'B：正式APIで自然な画像編集',status:'未接続・利用条件の確認が必要',kind:'official-api',pipeline:['editImageViaOfficialAdapter'],apiModelId:null,connected:false,candidates:['GPT-Image','Nano Banana']}
  ];
  const authentication = {chatgpt:{status:'未対応',reason:'正式仕様・対応資格を未確認。WebログインとAPI契約を結び付けません。'}};
  return {catalog,reasoningLevels,withProviderMetadata,imageModes,authentication};
})();
