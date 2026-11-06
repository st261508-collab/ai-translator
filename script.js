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
let revision = 0, busy = false, resultText = '', dbPromise, previewURL, toastTimer, historyRender = 0;
const hasTranslator = () => typeof globalThis.Translator?.create === 'function' && typeof globalThis.Translator?.availability === 'function';
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function setResult(text) { resultText = text; $('result').textContent = text; $('copy').disabled = !text; }
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
      if (hasTranslator() && !busy) await runTranslation({automatic:true});
      else toast('貼り付けました。翻訳エンジンが未対応、または翻訳中のため自動翻訳は実行しませんでした。');
    }
  } catch { toast('貼り付けにはブラウザの許可が必要です。Safariの確認で「ペースト」を選ぶか、入力欄を長押ししてください。入力内容はそのままです。'); $('source-text').focus(); }
});
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(resultText); toast('翻訳結果をコピーしました。'); } catch { toast('コピーできませんでした。翻訳結果を長押しして選択・コピーしてください。'); } });
function capability() { $('capability').textContent = hasTranslator() ? 'ブラウザの翻訳機能を検出しました。言語ペアや端末によって利用できない場合があります。初回は翻訳モデルのダウンロードが必要なことがあります。' : 'このブラウザでは翻訳できません。iPhone Safari は Chrome Translator API に未対応です。対応するパソコン版Chromeでお試しください。言語・端末によっても利用可否が異なります。'; $('translate').disabled = !hasTranslator(); }
// Engine boundary: future local or official API adapters should implement translate().
const engines = {
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
  if (!api?.create || !api?.availability) throw new Error('自動判定に未対応です。「言語設定」で原文の言語を選んでください。');
  await ensureAvailable(api, {}, '言語判定', automatic);
  let detector;
  try { detector = await api.create(); const results = await detector.detect(text); const best = results[0]; if (!best || best.confidence < 0.5 || best.detectedLanguage === 'und') throw new Error('言語を確実に判定できません。「言語設定」で原文の言語を選んでください。'); return best.detectedLanguage; }
  finally { detector?.destroy(); }
}
$('translate').addEventListener('click', () => runTranslation());
async function runTranslation({automatic = false} = {}) {
  if (busy || !hasTranslator()) return;
  const selectedModel = modelCatalog.find(model => model.id === $('translation-model').value);
  if (!selectedModel?.connected || !engines[selectedModel.id]) { toast('このモデルは未接続です。'); return; }
  const text = $('source-text').value.trim();
  if (!text) { toast('翻訳したい文章を入力してください。'); $('source-text').focus(); return; }
  const chosenSource = sourceLang, chosenForeign = foreignLang;
  busy = true; $('translate').disabled = true; $('translate').textContent = '翻訳を準備中…'; invalidate(); const activeRevision = revision;
  try {
    const from = chosenSource === 'auto' ? await detectLanguage(text, automatic) : chosenSource;
    const to = from.split('-')[0] === 'ja' ? chosenForeign : 'ja';
    $('translate').textContent = '翻訳中…';
    const translated = await engines[selectedModel.id].translate(text, from, to, automatic);
    if (revision !== activeRevision) { toast('入力・設定が変わったため、翻訳結果を破棄しました。再度翻訳してください。'); return; }
    if (typeof translated !== 'string' || !translated.trim()) throw new Error('翻訳結果を取得できませんでした。');
    setResult(translated); $('target-label').textContent = LANGUAGES[to] || to; $('result-note').textContent = `${LANGUAGES[from] || from} → ${LANGUAGES[to] || to}`;
    if ($('save-history').checked) {
      try { await saveRecord({original:text,translated,from,to,createdAt:Date.now()}); toast('翻訳して履歴に保存しました。'); }
      catch { toast('翻訳は完了しましたが、履歴を保存できませんでした。'); }
    }
  } catch (error) { if (revision === activeRevision) { $('result-note').textContent = '翻訳は完了していません'; toast(error instanceof Error ? error.message : '翻訳できませんでした。'); } }
  finally { busy = false; $('translate').textContent = '翻訳する ↗'; $('translate').disabled = !hasTranslator(); }
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
    const count = store.count(); count.onsuccess = () => { let extra = count.result - 200; if (extra > 0) { const cursor = store.openCursor(); cursor.onsuccess = () => { const c = cursor.result; if (c && extra-- > 0) { c.delete(); c.continue(); } }; } };
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
      const card = element('article',undefined,'history-card'); card.append(element('div',`${new Date(record.createdAt).toLocaleString('ja-JP')} · ${LANGUAGES[record.from] || record.from} → ${LANGUAGES[record.to] || record.to}`,'history-meta'),element('p',record.original),element('p',record.translated,'translation'));
      const actions = element('div',undefined,'history-actions'); const reuse = element('button','再利用','secondary');
      reuse.addEventListener('click', () => { $('source-text').value = record.original; sourceLang = LANGUAGES[record.from] ? record.from : 'auto'; if (record.from === 'ja' && LANGUAGES[record.to]) foreignLang = record.to; $('source-language').value = sourceLang; $('foreign-language').value = foreignLang; writePref('kp-settings',{source:sourceLang,foreign:foreignLang}); $('source-text').dispatchEvent(new Event('input')); updateLabels(); showPage('translate'); $('source-text').focus(); toast('原文を戻しました。「翻訳する」で再翻訳できます。'); });
      const remove = element('button','削除','text-button danger'); remove.setAttribute('aria-label','この履歴を削除'); remove.addEventListener('click', async () => { if (!confirm('この履歴を削除しますか？')) return; try { await historyOperation('readwrite',s => s.delete(record.id)); renderHistory(); } catch { toast('履歴を削除できませんでした。'); } }); actions.append(reuse,remove); card.append(actions); list.append(card);
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
$('translation-model').value = 'chrome';
function updateReasoning() {
  const model = modelCatalog.find(m => m.id === $('translation-model').value);
  const allowed = model.connected ? model.reasoning : [];
  for (const id of ['reasoning-level','settings-reasoning']) {
    $(id).replaceChildren();
    for (const [key,label] of Object.entries(reasoningLevels)) { const option = new Option(label,key); option.disabled = !allowed.includes(key); $(id).add(option); }
    const saved = readPref(`kp-reasoning-${model.id}`,'auto');
    $(id).value = allowed.includes(saved) ? saved : allowed[0] || '';
  }
}
$('translation-model').addEventListener('change', () => { invalidate(); updateReasoning(); renderModels(); });
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
    const top = element('div',undefined,'model-top'); top.append(element('h3',model.name),element('span',selected ? '選択中' : '未接続','badge')); card.append(top,element('p',model.description,'muted'));
    card.append(element('p',model.provider === 'browser' ? 'APIモデルID：対象外（ブラウザ機能）' : '公式APIモデルID：未確認・未設定','muted'));
    const selection = element('label',undefined,'check');
    const radio = element('input'); radio.type = 'radio'; radio.name = 'translation-model'; radio.value = model.id; radio.checked = selected; radio.disabled = !model.connected;
    radio.addEventListener('change', () => { $('translation-model').value = model.id; $('translation-model').dispatchEvent(new Event('change')); });
    selection.append(radio,document.createTextNode(model.connected ? 'このモデルを使用（対応ブラウザのみ）' : '未接続のため選択できません')); card.append(selection);
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
// OCR adapter boundary. Previewing does not run recognition or translation.
function clearImage() { if (previewURL) URL.revokeObjectURL(previewURL); previewURL = undefined; $('preview').removeAttribute('src'); $('image-file').value = ''; $('image-preview').hidden = true; }
$('choose-image').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('image-file').click(); } });
$('image-file').addEventListener('change', () => { const file = $('image-file').files[0]; if (!file) return; clearImage(); if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { toast('10MB以下のJPEG・PNG・WebP画像を選んでください。'); return; } previewURL = URL.createObjectURL(file); $('preview').src = previewURL; $('image-name').textContent = `${file.name} · プレビューのみ（翻訳は未実装）`; $('image-preview').hidden = false; });
$('preview').addEventListener('error', () => { clearImage(); toast('この画像を表示できませんでした。別の画像を選んでください。'); });
$('remove-image').addEventListener('click',clearImage);
updateLabels(); capability(); renderModels();
if ('serviceWorker' in navigator && window.isSecureContext) window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { toast('オフライン機能を登録できませんでした。通常の画面は利用できます。'); }); });
