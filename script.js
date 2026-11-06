'use strict';
const $ = (id) => document.getElementById(id);
const LANGUAGES = { ja:'日本語', en:'英語', zh:'中国語（簡体字）', 'zh-Hant':'中国語（繁体字）', ko:'韓国語', es:'スペイン語', fr:'フランス語', de:'ドイツ語', it:'イタリア語', pt:'ポルトガル語', ru:'ロシア語', ar:'アラビア語', hi:'ヒンディー語', th:'タイ語', vi:'ベトナム語', id:'インドネシア語' };
const readPref = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writePref = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('設定を保存できません。ブラウザの保存設定をご確認ください。'); return false; } };
let prefs = readPref('kp-settings', {});
if (!prefs || typeof prefs !== 'object') prefs = {};
let sourceLang = prefs.source === 'auto' || LANGUAGES[prefs.source] ? prefs.source : 'auto';
let foreignLang = LANGUAGES[prefs.foreign] && prefs.foreign !== 'ja' ? prefs.foreign : 'en';
let theme = readPref('kp-theme', null);
if (['light','dark'].includes(theme)) document.body.dataset.theme = theme;
let marks = readPref('kp-model-marks', {});
if (!marks || typeof marks !== 'object') marks = {};
let nativeAvailability='unknown',nativeProbe=0;
let revision = 0, busy = false, resultText = '', dbPromise, previewURL, toastTimer, historyRender = 0;
const hasTranslator = () => typeof globalThis.Translator?.create === 'function' && typeof globalThis.Translator?.availability === 'function';
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function setResult(text) { resultText = text; $('result').textContent = text; $('copy').disabled = !text; if ($('result-to-image')) $('result-to-image').disabled = !text; }
function invalidate() { revision++; setResult(''); const span = document.createElement('span'); span.className = 'placeholder'; span.textContent = 'ここに翻訳結果が表示されます。'; $('result').append(span); $('result-note').textContent = '対応ブラウザで翻訳できます'; }
function showPage(name) {
  document.querySelectorAll('.page').forEach(page => { page.hidden = page.id !== `page-${name}`; });
  document.querySelectorAll('.tab').forEach(tab => { const active = tab.dataset.page === name; tab.classList.toggle('active', active); if (active) tab.setAttribute('aria-current','page'); else tab.removeAttribute('aria-current'); });
  if (name === 'history') renderHistory();
}
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => showPage(tab.dataset.page)));
$('theme-toggle').addEventListener('click', () => { const dark = document.body.dataset.theme ? document.body.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; theme = dark ? 'light' : 'dark'; document.body.dataset.theme = theme; writePref('kp-theme',theme); });
function updateLabels() { $('source-label').textContent = sourceLang === 'auto' ? '自動判定' : LANGUAGES[sourceLang]; $('target-label').textContent = sourceLang === 'ja' ? LANGUAGES[foreignLang] : sourceLang === 'auto' ? `日本語 / ${LANGUAGES[foreignLang]}` : '日本語'; }
for (const [code, name] of [['auto','自動判定'], ...Object.entries(LANGUAGES)]) $('source-language').add(new Option(name,code));
for (const [code, name] of Object.entries(LANGUAGES)) if (code !== 'ja') $('foreign-language').add(new Option(name,code));
$('source-language').value = sourceLang; $('foreign-language').value = foreignLang;
$('open-settings').addEventListener('click', () => $('settings').showModal());
for (const id of ['source-language','foreign-language']) $(id).addEventListener('change', () => { sourceLang = $('source-language').value; foreignLang = $('foreign-language').value; writePref('kp-settings',{source:sourceLang,foreign:foreignLang}); invalidate(); updateLabels(); });
$('source-text').addEventListener('input', () => { $('char-count').textContent = `${$('source-text').value.length.toLocaleString('ja-JP')} / 5,000`; invalidate(); });
$('clear-text').addEventListener('click', () => { $('source-text').value = ''; $('source-text').dispatchEvent(new Event('input')); $('source-text').focus(); });
$('auto-translate-paste').checked = readPref('kp-auto-paste',false) === true;
$('auto-translate-paste').addEventListener('change', () => writePref('kp-auto-paste',$('auto-translate-paste').checked));
$('paste').addEventListener('click', async () => {
  const beforeRead = revision;
  try {
    // Read directly in the click handler. Never bypass Safari's permission UI.
    const text = await navigator.clipboard.readText();
    if (revision !== beforeRead) { toast('入力が変わったため貼り付けを中止しました。もう一度押してください。'); return; }
    if (!text) { toast('クリップボードに文章がありません。入力内容はそのままです。'); return; }
    $('source-text').value = text.slice(0,5000); $('source-text').dispatchEvent(new Event('input'));
    if (text.length > 5000) toast('先頭の5,000文字を貼り付けました。');
    if ($('auto-translate-paste').checked) {
      if (selectedEngineUsable() && !busy) await runTranslation({automatic:true});
      else toast('貼り付けました。翻訳エンジンが未対応、または翻訳中のため自動翻訳は実行しませんでした。');
    }
  } catch { toast('貼り付けにはブラウザの許可が必要です。Safariの確認で「ペースト」を選ぶか、入力欄を長押ししてください。入力内容はそのままです。'); $('source-text').focus(); }
});
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(resultText); toast('翻訳結果をコピーしました。'); } catch { toast('コピーできませんでした。翻訳結果を長押しして選択・コピーしてください。'); } });
function selectedEngineUsable() { const id = $('translation-model').value; return id === 'chrome' ? hasTranslator() : id === 'transformers' && LocalTranslation.supported(); }
function capability() {
  $('capability').textContent = $('translation-model').value === 'transformers' ? '無料OPUS-MTモデル：日本語⇔英語を端末内のWASMで翻訳します。初回は配布元の容量・ライセンスを表示して確認します。iPhone実機は未検証です。' : hasTranslator() ? 'Chrome翻訳機能を検出しました。対応言語とモデル取得状態は翻訳時に確認します。' : 'Chrome Translatorはこの端末では非対応です。日英の無料WASMモデルを選んでください。';
  $('translate').disabled = busy || !selectedEngineUsable();
}
function updateProgress(progress) {
  $('translation-progress').hidden = false;
  if(progress.status === 'progress') {
    $('progress-label').textContent = `${progress.file || 'モデル'}：${((progress.loaded||0)/1048576).toFixed(1)} MB / ${progress.total ? (progress.total/1048576).toFixed(1)+' MB' : '容量取得中'}`;
    if(progress.total){$('download-progress').max=progress.total;$('download-progress').value=progress.loaded||0;}else $('download-progress').removeAttribute('value');
  } else if(progress.status === 'inference') {
    $('progress-label').textContent=`端末内で翻訳中 ${progress.done+1} / ${progress.total}（初回は時間がかかります）`;$('download-progress').max=progress.total;$('download-progress').value=progress.done;
  } else { $('progress-label').textContent=progress.status==='ready'?'モデル準備完了':'モデルを準備しています…';$('download-progress').removeAttribute('value'); }
}
$('cancel-translation').addEventListener('click',()=>{revision++;LocalTranslation.cancel();toast('中止を要求しました。Chromeの実行は完了時に破棄されます。');});
// Engine boundary: future local or official API adapters should implement translate().
const engines = {
  transformers: {async translate(text,from,to,automatic=false){return LocalTranslation.translate(text,from,to,{automatic,onProgress:updateProgress,confirmDownload:meta=>confirm(`${meta.repo}\nライセンス：${meta.license}\nモデル容量：${meta.bytes ? (meta.bytes/1048576).toFixed(1)+' MB（必要ファイル候補の合計。実通信量とは異なる場合あり）' : '配布元で容量取得できず不明'} + WASM約21 MB・ライブラリ約1 MB\n空きメモリは数百MB〜1GB以上の余裕が必要な場合があります（端末別の実測値は未確認）。キャッシュがあれば再利用します。Wi-Fi推奨。モデルを読み込みますか？`)});}},
  chrome: {
    async translate(text, from, to, automatic = false) {
      const options = {sourceLanguage:from,targetLanguage:to};
      await ensureAvailable(globalThis.Translator, options, '翻訳', automatic);
      let translator;
      try { translator = await globalThis.Translator.create(options); return await translator.translate(text); }
      finally { translator?.destroy(); }
    }
  }
};
async function ensureAvailable(api, options, label, automatic = false) {
  const status = await api.availability(options);
  if (status === 'unavailable') throw new Error(`${label}に必要なモデルが、この端末または言語では利用できません。`);
  if (automatic && status !== 'available') throw new Error('貼り付けました。モデル取得が必要なため自動翻訳は実行しません。「翻訳する」を押して確認してください。');
  if (['downloadable','downloading'].includes(status) && !confirm(`${label}用モデルのダウンロードが必要です。通信量と端末の空き容量を使用します。続けますか？`)) throw new Error('ダウンロードを中止しました。');
  if (!['available','downloadable','downloading'].includes(status)) throw new Error('ブラウザから利用状態を確認できませんでした。');
}
async function detectLanguage(text, automatic = false) {
  const api = globalThis.LanguageDetector;
  if (!api?.create || !api?.availability) {
    if (/[ぁ-ゖァ-ヺ]/u.test(text)) {$('source-label').textContent='日本語（日英の簡易判定）'; return 'ja';}
    if (/[a-z]/i.test(text) && /^[\p{Script=Latin}\p{P}\p{N}\p{Z}\s]+$/u.test(text)) {$('source-label').textContent='英語と仮定（簡易判定・手動指定推奨）'; return 'en';}
    throw new Error('日英の簡易判定で言語を確定できません。「設定・言語」で原文の言語を選んでください。');
  }
  await ensureAvailable(api, {}, '言語判定', automatic);
  let detector;
  try { detector = await api.create(); const results = await detector.detect(text); const best = results[0]; if (!best || best.confidence < 0.5 || best.detectedLanguage === 'und') throw new Error('言語を確実に判定できません。「言語設定」で原文の言語を選んでください。'); return best.detectedLanguage; }
  finally { detector?.destroy(); }
}
$('translate').addEventListener('click', () => runTranslation());
async function runTranslation({automatic = false,modelId = null} = {}) {
  if (busy) return;
  const selectedModel = modelCatalog.find(model => model.id === (modelId || $('translation-model').value));
  if (!selectedModel?.connected || !engines[selectedModel.id]) { toast('このモデルは未接続です。'); return; }
  const text = $('source-text').value.trim();
  if (!text) { toast('翻訳したい文章を入力してください。'); $('source-text').focus(); return; }
  const chosenSource = sourceLang, chosenForeign = foreignLang;
  $('translation-error').hidden=true;
  busy = true; $('translate').disabled = true; $('translate').textContent = '翻訳を準備中…'; invalidate(); const activeRevision = revision;
  updateProgress({status:'prepare'});
  try {
    const from = chosenSource === 'auto' ? await detectLanguage(text, automatic) : chosenSource;
    const to = from.split('-')[0] === 'ja' ? chosenForeign : 'ja';
    $('translate').textContent = '翻訳中…';
    if (revision !== activeRevision) return;
    const translated = await engines[selectedModel.id].translate(text, from, to, automatic);
    if (revision !== activeRevision) { toast('入力・設定が変わったため、翻訳結果を破棄しました。再度翻訳してください。'); return; }
    if (typeof translated !== 'string' || !translated.trim()) throw new Error('翻訳結果を取得できませんでした。');
    if(selectedModel.id==='chrome')nativeAvailability='available';
    setResult(translated); $('target-label').textContent = LANGUAGES[to] || to; $('result-note').textContent = `${LANGUAGES[from] || from} → ${LANGUAGES[to] || to}`;
    const record = {original:text,translated,from,to,createdAt:Date.now(),model:selectedModel.name,modelId:selectedModel.id,method:'local',style:'model-default',manual:false};
    writePref('kp-last-used',{model:record.model,manual:false});if(typeof showLastUsed==='function')showLastUsed();dispatchEvent(new CustomEvent('kotoba-result',{detail:record}));
    if ($('save-history').checked) {
      try { await saveRecord(record); toast('翻訳して履歴に保存しました。'); }
      catch { toast('翻訳は完了しましたが、履歴を保存できませんでした。'); }
    }
    renderModels(); return record;
  } catch (error) { if (revision === activeRevision) { $('result-note').textContent = '翻訳は完了していません'; const message=error instanceof Error ? error.message : '翻訳できませんでした。'; $('translation-error').textContent=message; $('translation-error').hidden=false; toast(message); } }
  finally { busy = false; $('translate').textContent = '翻訳する ↗'; $('translation-progress').hidden=true; capability(); }
}
function openDB() {
  if (!dbPromise) dbPromise = new Promise((resolve,reject) => {
    const req = indexedDB.open('kotoba-pocket',1);
    req.onupgradeneeded = () => { const store = req.result.createObjectStore('history',{keyPath:'id',autoIncrement:true}); store.createIndex('createdAt','createdAt'); };
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); dbPromise = null; }; resolve(req.result); };
    req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('履歴データベースを開けません。別のタブを閉じてください。'));
  }).catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}
async function historyOperation(mode, action) { const db = await openDB(); return new Promise((resolve,reject) => { const tx = db.transaction('history',mode); const request = action(tx.objectStore('history')); tx.oncomplete = () => resolve(request?.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
async function saveRecord(record) {
  const db = await openDB();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('history','readwrite'), store = tx.objectStore('history'); store.add(record);

    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
$('save-history').checked = readPref('kp-save-history',false) === true;
$('save-history').addEventListener('change', async () => { if ($('save-history').checked) { try { await openDB(); } catch { $('save-history').checked = false; toast('このブラウザでは履歴を保存できません。'); } } writePref('kp-save-history',$('save-history').checked); });
function element(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
async function renderHistory() {
  const ticket = ++historyRender;
  try {
    const records = await historyOperation('readonly', store => store.getAll()); if (ticket !== historyRender) return;
    const query = $('history-search').value.toLocaleLowerCase(); const list = $('history-list'); list.replaceChildren();
    const matching = records.reverse().filter(r => `${r.original}\n${r.translated}`.toLocaleLowerCase().includes(query));
    if (!matching.length) list.append(element('p',query ? '一致する履歴がありません。' : '履歴はまだありません。保存をオンにして翻訳すると、ここに表示されます。','empty'));
    for (const record of matching) {
      const card = element('article',undefined,'history-card'); card.append(element('div',`${new Date(record.createdAt).toLocaleString('ja-JP')} · ${LANGUAGES[record.from] || record.from} → ${LANGUAGES[record.to] || record.to}`,'history-meta'),element('p',`${record.manual ? '手動取り込み' : record.method==='local' ? '端末内の自動翻訳' : '旧版の記録（方式不明）'} · ${record.model || 'モデル未記録'}`,'history-meta'),element('p',record.original),element('p',record.translated,'translation'));
      const actions = element('div',undefined,'history-actions'); const reuse = element('button','再利用','secondary');
      reuse.addEventListener('click', () => { $('source-text').value = record.original; sourceLang = LANGUAGES[record.from] ? record.from : 'auto'; if (record.from === 'ja' && LANGUAGES[record.to]) foreignLang = record.to; $('source-language').value = sourceLang; $('foreign-language').value = foreignLang; writePref('kp-settings',{source:sourceLang,foreign:foreignLang}); $('source-text').dispatchEvent(new Event('input')); updateLabels(); showPage('translate'); $('source-text').focus(); toast('原文を戻しました。「翻訳する」で再翻訳できます。'); });
      const remove = element('button','削除','text-button danger'); remove.setAttribute('aria-label','この履歴を削除'); remove.addEventListener('click', async () => { if (!confirm('この履歴を削除しますか？')) return; try { await historyOperation('readwrite',s => s.delete(record.id)); renderHistory(); } catch { toast('履歴を削除できませんでした。'); } }); const favorite = element('button',record.isFavorite ? '★ お気に入り済み' : '☆ お気に入り','secondary'); favorite.setAttribute('aria-pressed',String(!!record.isFavorite));
      favorite.addEventListener('click',async()=>{try{await historyOperation('readwrite',store=>store.put({...record,isFavorite:!record.isFavorite}));renderHistory();}catch{toast('お気に入りを保存できませんでした。');}});
      const compare=element('button','比較に追加','secondary'); compare.addEventListener('click',()=>{dispatchEvent(new CustomEvent('kotoba-result',{detail:record}));showPage('compare');});
      actions.append(reuse,favorite,compare,remove); card.append(actions); list.append(card);
    }
  } catch { if (ticket === historyRender) $('history-list').replaceChildren(element('p','履歴を開けません。ブラウザの保存設定をご確認ください。','empty')); }
}
$('history-search').addEventListener('input',renderHistory);
$('delete-all').addEventListener('click', async () => { if (!confirm('この端末の翻訳履歴をすべて削除しますか？元に戻せません。')) return; try { await historyOperation('readwrite',s => s.clear()); await renderHistory(); toast('すべての履歴を削除しました。'); } catch { toast('履歴を削除できませんでした。'); } });
const modelCatalog = KotobaModels.catalog;
const reasoningLevels = KotobaModels.reasoningLevels;
let customOrder = readPref('kp-model-order',[]);
if (!Array.isArray(customOrder)) customOrder = [];
customOrder = [...new Set(customOrder.filter(id => modelCatalog.some(m => m.id === id)))];
for (const model of modelCatalog) if (!customOrder.includes(model.id)) customOrder.push(model.id);
const savedSort = readPref('kp-model-sort','recommended');
$('model-sort').value = ['recommended','name','custom'].includes(savedSort) ? savedSort : 'recommended';
for (const model of modelCatalog) {
  const option = new Option(`${model.name}${model.connected ? '' : '（未接続）'}`,model.id);
  option.disabled = !model.connected; $('translation-model').add(option);
}
const lastModel=readPref('kp-last-model',null);
$('translation-model').value=modelCatalog.some(m=>m.id===lastModel&&m.connected)?lastModel:hasTranslator()?'chrome':'transformers';
function updateReasoning() {
  const model = modelCatalog.find(m => m.id === $('translation-model').value);
  const allowed = model.connected ? model.reasoning : [];
  $('reasoning-note').textContent='翻訳専用モデルは思考量を変更できないため、設定は無効です。外部Webの思考量はこのアプリから制御できません。';
  for (const id of ['reasoning-level','settings-reasoning']) {
    $(id).replaceChildren();
    for (const [key,label] of Object.entries(reasoningLevels)) { const option = new Option(label,key); option.disabled = !allowed.includes(key); $(id).add(option); }
    const saved = readPref(`kp-reasoning-${model.id}`,'auto');
    $(id).value = allowed.includes(saved) ? saved : 'auto'; $(id).disabled=!allowed.length;
  }
}
$('translation-model').addEventListener('change', () => { writePref('kp-last-model',$('translation-model').value);invalidate(); updateReasoning(); capability(); renderModels(); });
for (const id of ['reasoning-level','settings-reasoning']) $(id).addEventListener('change', () => {
  const model = modelCatalog.find(m => m.id === $('translation-model').value);
  if (!model.connected || !model.reasoning.includes($(id).value)) { updateReasoning(); return; }
  writePref(`kp-reasoning-${model.id}`,$(id).value); updateReasoning();
});
function renderModels() {
  const query = $('model-search').value.trim().toLocaleLowerCase();
  const sort = $('model-sort').value;
  const sorted = [...modelCatalog].sort((a,b) => {
    if (sort === 'name') return a.name.localeCompare(b.name,'ja');
    if (sort === 'recommended') { const priority = Number(!!marks[b.id]?.pinned) - Number(!!marks[a.id]?.pinned) || Number(!!marks[b.id]?.favorite) - Number(!!marks[a.id]?.favorite); if (priority) return priority; }
    return customOrder.indexOf(a.id) - customOrder.indexOf(b.id);
  }).filter(m => `${m.name} ${m.provider}`.toLocaleLowerCase().includes(query));
  $('model-list').replaceChildren();
  if (!sorted.length) $('model-list').append(element('p','一致するモデルがありません。','empty'));
  for (const model of sorted) {
    const selected = model.id === $('translation-model').value;
    const card = element('article',undefined,`model-card${selected ? ' selected' : ''}`); card.dataset.modelId = model.id;
    const top = element('div',undefined,'model-top'); top.append(element('h3',model.name),element('span',modelState(model),'badge')); card.append(top,element('p',model.description,'muted'));
    card.append(element('p',model.provider === 'browser' ? 'APIモデルID：対象外（ブラウザ機能）' : '公式APIモデルID：未確認・未設定','muted'));
    card.append(element('p',`${model.provider==='browser'||model.provider==='local'?'API利用料金0円':'料金未確認。外部Webは公式の無料枠・制限、APIは別契約・料金確認が必要。'} · 対応言語：${model.languages || (model.provider==='browser'?'ブラウザで確認':'未確認')} · 方式：${model.provider==='local'?'端末内WASM':model.provider==='browser'?'端末内Chrome':'外部Webで手動操作／API未接続'}`,'muted'));
    if(model.id==='transformers'){for(const [from,to]of [['en','ja'],['ja','en']]){const meta=LocalTranslation.cachedMeta(from,to);card.append(element('p',meta?`${meta.repo}：候補ファイル合計 ${(meta.bytes/1048576).toFixed(1)} MB（モデルのみ、${meta.license}）`:`${from}→${to}：容量・ライセンスは初回取得時に配布元で確認。`,'muted'));const link=element('a','公式モデルカード ↗');link.href='https://huggingface.co/'+LocalTranslation.pairs[`${from}-${to}`].repo;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}}
    const selection = element('label',undefined,'check');
    const radio = element('input'); radio.type = 'radio'; radio.name = 'translation-model'; radio.value = model.id; radio.checked = selected; radio.disabled = !model.connected;
    radio.addEventListener('change', () => { $('translation-model').value = model.id; $('translation-model').dispatchEvent(new Event('change')); });
    selection.append(radio,document.createTextNode(model.connected ? 'このモデルを使用' : 'このモデルをアプリ内で実行することはできません')); card.append(selection);
    const actions = element('div',undefined,'model-actions');
    for (const [key,on,off] of [['favorite','★ お気に入り済み','☆ お気に入り'],['pinned','ピン留め済み','ピン留め']]) {
      const button = element('button',marks[model.id]?.[key] ? on : off,'secondary'); button.setAttribute('aria-pressed',String(!!marks[model.id]?.[key])); button.setAttribute('aria-label',`${model.name}：${key === 'favorite' ? 'お気に入り' : 'ピン留め'}`);
      button.addEventListener('click', () => { marks[model.id] = {...marks[model.id],[key]:!marks[model.id]?.[key]}; writePref('kp-model-marks',marks); renderModels(); }); actions.append(button);
    }
    for (const [offset,label] of [[-1,'上へ'],[1,'下へ']]) {
      const button = element('button',label,'secondary'); const pos = customOrder.indexOf(model.id);
      button.setAttribute('aria-label',`${model.name}：${label}`);
      button.disabled = sort !== 'custom' || !!query || pos+offset < 0 || pos+offset >= customOrder.length;
      button.addEventListener('click', () => { [customOrder[pos],customOrder[pos+offset]] = [customOrder[pos+offset],customOrder[pos]]; writePref('kp-model-order',customOrder); renderModels(); }); actions.append(button);
    }
    card.append(actions); $('model-list').append(card);
  }
}
$('model-search').addEventListener('input',renderModels);
$('model-sort').addEventListener('change', () => { writePref('kp-model-sort',$('model-sort').value); renderModels(); });
for (const mode of KotobaModels.imageModes) {
  const item = element('div',undefined,'image-mode'); const label = element('label',undefined,'check'); const radio = element('input'); radio.type = 'radio'; radio.name = 'image-mode'; radio.value = mode.id; radio.disabled = !mode.connected;
  label.append(radio,document.createTextNode(mode.name)); item.append(label,element('p',mode.status,'muted'));
  if (mode.candidates) item.append(element('p',`${mode.candidates.join(' / ')}：候補名です。公式モデルID・提供状況・年齢条件・料金の確認が必要です。`,'muted'));
  $('image-modes').append(item);
}
updateReasoning();
// Image editing runs in image-editor.js; original previews stay local.
function clearImage() { dispatchEvent(new Event('kotoba-image-clear')); if (previewURL) URL.revokeObjectURL(previewURL); previewURL = undefined; $('preview').removeAttribute('src'); $('image-file').value = ''; $('image-preview').hidden = true; }
$('choose-image').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('image-file').click(); } });
$('image-file').addEventListener('change', () => { const file = $('image-file').files[0]; if (!file) return; clearImage(); if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { toast('10MB以下のJPEG・PNG・WebP画像を選んでください。'); return; } previewURL = URL.createObjectURL(file); $('preview').src = previewURL; $('image-name').textContent = `${file.name} · 元画像（端末内で処理）`; $('image-preview').hidden = false; dispatchEvent(new Event('kotoba-image-selected')); });
$('preview').addEventListener('error', () => { clearImage(); toast('この画像を表示できませんでした。別の画像を選んでください。'); });
$('remove-image').addEventListener('click',clearImage);
function modelState(model){if(model.id==='chrome')return !hasTranslator()||nativeAvailability==='unavailable'?'この端末・言語では非対応':nativeAvailability==='available'?'端末内で利用可能':nativeAvailability==='downloadable'||nativeAvailability==='downloading'?'ダウンロードが必要':'利用状態を確認中';if(model.id==='transformers')return !LocalTranslation.supported()?'この端末では非対応':LocalTranslation.isLoaded('ja','en')||LocalTranslation.isLoaded('en','ja')?'端末内で利用可能':'ダウンロードが必要（キャッシュがあれば再利用）';return '未接続・利用条件の確認が必要';}
updateLabels(); capability(); renderModels();
if ('serviceWorker' in navigator && window.isSecureContext) window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { toast('オフライン機能を登録できませんでした。通常の画面は利用できます。'); }); });
// Probe the actual selected language pair rather than treating an API symbol as readiness.

async function refreshNativeAvailability(){
 const ticket=++nativeProbe,model=modelCatalog.find(m=>m.id==='chrome');
 try{
  const from=sourceLang==='auto'?'en':sourceLang,to=from==='ja'?foreignLang:'ja';
  const state=hasTranslator()?await Translator.availability({sourceLanguage:from,targetLanguage:to}):'unavailable';
  if(ticket!==nativeProbe)return;nativeAvailability=state;model.connected=state!=='unavailable'&&hasTranslator();
  $('translation-model').querySelector('option[value=chrome]').disabled=!model.connected;
  if(!model.connected&&$('translation-model').value==='chrome'&&LocalTranslation.supported()){$('translation-model').value='transformers';updateReasoning();}
  capability();renderModels();
 }catch{if(ticket===nativeProbe){nativeAvailability='unknown';capability();renderModels();}}
}
for(const id of ['source-language','foreign-language'])$(id).addEventListener('change',refreshNativeAvailability);
refreshNativeAvailability();
