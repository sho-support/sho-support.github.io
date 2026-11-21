import { checkMaterialSelection } from './website-materials.js';

const element = (id) => document.getElementById(id);
const ownerMode = document.documentElement.dataset.demo === 'band-owner'
  || new URLSearchParams(location.search).get('mode') === 'band-owner';
const plans = [...document.querySelectorAll('.plan')];
const planLabels = {
  live: ['LIVE更新', '¥1,000 / 回', 'LIVE情報のみを1回更新できます。'],
  normal: ['通常更新', '¥2,500 / 回', 'LIVE・写真・文章・その他の変更を、まとめて1回の更新依頼として送れます。'],
  unlimited: ['月8回まで', '¥7,000 / 月', '通常更新と同じ内容を月8回まで依頼できます。'],
};
const sampleUpcoming = { date: '2027-01-10', time: '18:30', name: 'ROCK NIGHT 2027', place: '仙台 LIVE HOUSE' };
const samplePast = {
  date: '2026-09-05', name: 'JAS FESTIVAL', place: '榴岡公園野外音楽堂',
  setlist: ['It’s So Easy', 'Out Ta Get Me', 'Welcome to the Jungle', 'Knockin’ on Heaven’s Door', 'Sweet Child O’ Mine', 'Nightrain', 'Paradise City'],
};
const fileInput = element('photoFile');
const saveButton = element('applyAll');
const emptyPhotos = () => ({ top: null, gallery: [] });
let photos = emptyPhotos();
let previewUrls = [];
let plan = 'normal';
let toastTimer;

function status(message, isError = false) {
  const box = element('formStatus');
  box.textContent = message;
  box.classList.toggle('error', isError);
}

function toast(message) {
  const box = element('toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 1600);
}

function applyPlan(name) {
  plan = name;
  const [label, cost, detail] = planLabels[name];
  plans.forEach((button) => button.classList.toggle('active', button.dataset.plan === name));
  element('planLabel').textContent = label;
  element('priceLabel').textContent = cost;
  const note = element('requestNote');
  note.querySelector('strong').textContent = label;
  note.querySelector('span').textContent = detail;
  document.querySelectorAll('.nonlive').forEach((block) => {
    const locked = name === 'live';
    block.classList.toggle('disabled', locked);
    block.querySelectorAll('input,textarea,select').forEach((field) => { field.disabled = locked; });
  });
}

function addEntry(container, values = {}) {
  const past = container === element('pastItems');
  const row = document.createElement('div');
  row.className = 'live-entry';
  row.innerHTML = `
    <div class="live-entry-head"><b>${past ? '過去ライブ' : 'ライブ予定'}</b><button type="button" class="remove-live">削除</button></div>
    <div class="fieldrow">
      <label class="field">開催日<input name="date" type="date"></label>
      <label class="field">時間<input name="time" type="time"></label>
    </div>
    <label class="field">イベント名<input name="name" maxlength="150" placeholder="イベント名"></label>
    <label class="field">会場<input name="place" maxlength="150" placeholder="会場"></label>
    <label class="field">イベント詳細<textarea name="detail" maxlength="2000"></textarea></label>
    ${past ? `
      <label class="field">YouTubeリンク<input name="video" type="url" maxlength="500" placeholder="https://youtu.be/…"></label>
      <label class="field">セットリスト<textarea name="setlist" maxlength="5000" placeholder="1行に1曲ずつ入力"></textarea></label>
    ` : ''}`;
  row.querySelectorAll('[name]').forEach((field) => {
    const value = values[field.name];
    field.value = Array.isArray(value) ? value.join('\n') : value ?? '';
  });
  row.querySelector('.remove-live').onclick = () => row.remove();
  container.append(row);
  return row;
}

function videoUrl(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('過去ライブのYouTubeリンクを確認してください。'); }
  const pathParts = url.pathname.split('/').filter(Boolean);
  const youtubeHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
  let id;
  if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
    if (url.hostname === 'youtu.be' && pathParts.length === 1) id = pathParts[0];
    if (youtubeHosts.includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      if (['live', 'shorts', 'embed'].includes(pathParts[0]) && pathParts.length === 2) id = pathParts[1];
    }
  }
  if (!/^[\w-]{11}$/.test(id ?? '')) throw new Error('過去ライブにはYouTubeの動画リンクを入力してください。');
  return 'https://www.youtube.com/watch?v=' + id;
}

function readEntries(container) {
  return [...container.querySelectorAll('.live-entry')].flatMap((row) => {
    const values = Object.fromEntries([...row.querySelectorAll('[name]')].map((field) => [field.name, field.value.trim()]));
    if (!Object.values(values).some(Boolean)) return [];
    if (ownerMode && (!values.date || !values.name)) throw new Error('ライブの開催日とイベント名を入力してください。');
    return [{ ...values, video: videoUrl(values.video), setlist: (values.setlist || '').split('\n').map((song) => song.trim()).filter(Boolean) }];
  });
}

function addText(parent, tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  parent.append(node);
  return node;
}

function renderEvents(entries, list, past) {
  list.replaceChildren();
  if (!entries.length) {
    addText(list, 'p', past ? '過去ライブは未登録です。' : '登録したライブ予定がここに表示されます。');
    return;
  }
  const ordered = [...entries].sort((a, b) => (past ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  for (const event of ordered) {
    const card = document.createElement('article');
    card.className = 'livecard';
    addText(card, 'strong', event.name || 'LIVE EVENT');
    addText(card, 'span', [event.date ? event.date.replaceAll('-', '.') : '日程未定', event.time].filter(Boolean).join(' / '));
    card.append(document.createElement('br'));
    addText(card, 'span', event.place || '会場未定');
    if (event.detail || event.video || event.setlist?.length) {
      const details = addText(card, 'details', '');
      addText(details, 'summary', past ? 'ライブ詳細・セットリスト' : 'イベント詳細');
      if (event.detail) {
        const text = addText(details, 'p', event.detail);
        text.style.whiteSpace = 'pre-wrap';
      }
      if (event.setlist?.length) {
        const songs = addText(details, 'ol', '');
        event.setlist.forEach((song) => addText(songs, 'li', song));
      }
      if (event.video) {
        const link = addText(details, 'a', 'YouTubeでライブ動画を見る');
        link.href = videoUrl(event.video);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }
    list.append(card);
  }
}

function draftPhotos() {
  const selected = [...fileInput.files];
  const top = element('photoTarget').value === 'top';
  if (top && selected.length > 1) throw new Error('トップ写真は1枚選択してください。');
  const next = {
    top: top && selected.length ? selected[0] : photos.top,
    gallery: top ? photos.gallery : [...photos.gallery, ...selected],
  };
  checkMaterialSelection([], [next.top, ...next.gallery].filter(Boolean));
  return next;
}

function photoUrl(file) {
  const url = URL.createObjectURL(file);
  previewUrls.push(url);
  return url;
}

function renderPhotos() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  const hero = element('mockHero');
  hero.style.backgroundImage = photos.top ? `linear-gradient(180deg,rgba(0,0,0,.1),#090909),url("${photoUrl(photos.top)}")` : '';
  const gallery = element('gallery');
  gallery.replaceChildren();
  for (const photo of photos.gallery) {
    const cell = addText(gallery, 'div', '');
    const image = document.createElement('img');
    image.src = photoUrl(photo);
    image.alt = photo.name;
    cell.append(image);
  }
  if (!photos.gallery.length) addText(gallery, 'div', '写真未登録').className = 'gallery-empty';

  const saved = element('savedPhotos');
  const entries = [photos.top, ...photos.gallery];
  saved.replaceChildren();
  saved.hidden = !ownerMode || !entries.some(Boolean);
  if (saved.hidden) return;
  entries.forEach((photo, index) => {
    if (!photo) return;
    const row = addText(saved, 'li', '');
    addText(row, 'span', (index === 0 ? 'TOP / ' : 'GALLERY / ') + photo.name);
    const remove = addText(row, 'button', '削除');
    remove.type = 'button';
    remove.className = 'remove-live';
    remove.setAttribute('aria-label', `${photo.name}を削除`);
    remove.onclick = () => {
      if (index === 0) photos.top = null;
      else photos.gallery = photos.gallery.filter((_, position) => position !== index - 1);
      renderPhotos();
      status('写真の削除を下書きに保存してください。');
    };
  });
}

function renderPreview(draft) {
  renderEvents(draft.upcoming, element('liveList'), false);
  element('archivePreview').hidden = !ownerMode && !draft.past.length;
  renderEvents(draft.past, element('pastList'), true);
  element('pNotice').textContent = draft.notice;
  element('pNotice').hidden = !draft.notice;
  const other = element('otherPreview');
  other.textContent = draft.other ? '更新要望: ' + draft.other : '';
  other.style.display = draft.other ? 'block' : 'none';
  renderPhotos();
}

async function accessDraft(next) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sho-guns-n-loses-update-demo', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブで確認画面を使用中です。'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('drafts', next ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('drafts');
      const request = next ? store.put(next, 'current') : store.get('current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('下書きの保存が中断されました。'));
    });
  } finally { database.close(); }
}

const upcoming = element('liveItems');
const past = element('pastItems');
element('addLive').onclick = () => addEntry(upcoming).querySelector('input').focus();
element('addPast').onclick = () => addEntry(past).querySelector('input').focus();
element('resetAll').onclick = () => location.reload();
plans.forEach((button) => { button.onclick = () => applyPlan(button.dataset.plan); });
applyPlan('normal');

let current = { upcoming: [sampleUpcoming], past: [], photos: emptyPhotos(), notice: element('noticeText').value, other: '' };
if (ownerMode) {
  document.title = "Guns N' Loses｜更新管理の確認";
  element('modeLabel').textContent = 'SITE MANAGEMENT';
  element('pageTitle').textContent = '更新管理の確認';
  element('pageIntro').textContent = '写真やライブ情報を編集し、サイト見本で確認できます。';
  element('previewScope').textContent = '確認用です。下書きはこのブラウザ内に保存されます。';
  element('siteName').textContent = "Guns N' Loses";
  element('pBand').textContent = "Guns N' Loses";
  element('previewName').textContent = "Guns N' Loses";
  element('siteMark').textContent = '確認用';
  element('viewCount').textContent = '—';
  element('allowanceLabel').textContent = '残更新回数';
  for (const id of ['allowanceValue', 'planLabel', 'priceLabel']) element(id).textContent = '';
  document.querySelector('.plans').hidden = true;
  element('requestNote').hidden = true;
  element('photoNoteField').hidden = true;
  fileInput.multiple = true;
  element('resetAll').textContent = '前回の保存に戻す';
  saveButton.textContent = '下書きを保存して確認';
  saveButton.disabled = true;
  current = { ...current, upcoming: [], past: [samplePast], notice: '' };
  try { current = await accessDraft() || current; }
  catch { status('このブラウザでは下書きの保存を開けませんでした。', true); }
  photos = current.photos;
  saveButton.disabled = false;
}
for (const event of current.upcoming.length ? current.upcoming : [{}]) addEntry(upcoming, event);
for (const event of current.past) addEntry(past, event);
element('noticeText').value = current.notice;
element('otherRequest').value = current.other;
renderPreview(current);

saveButton.onclick = async () => {
  try {
    saveButton.disabled = true;
    const canEditOther = plan !== 'live';
    const next = {
      upcoming: readEntries(upcoming), past: readEntries(past), photos: canEditOther ? draftPhotos() : photos,
      notice: canEditOther ? element('noticeText').value.trim() : current.notice,
      other: canEditOther ? element('otherRequest').value.trim() : current.other,
    };
    let storageError = false;
    if (ownerMode) {
      try { await accessDraft(next); }
      catch { storageError = true; }
    }
    current = next;
    photos = next.photos;
    renderPreview(next);
    fileInput.value = '';
    if (storageError) {
      status('サイト見本に反映しました。ブラウザへの下書き保存に失敗しました。', true);
      return;
    }
    const message = ownerMode ? 'このブラウザに下書きを保存しました。' : 'まとめて更新を反映しました。';
    status(message);
    toast(message);
  } catch (error) {
    status(error instanceof DOMException ? '下書きを保存できませんでした。画像の容量とブラウザの保存設定を確認してください。' : error.message, true);
  } finally { saveButton.disabled = false; }
};
