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
// Confirmation data from the band's published live history.
const samplePast = [
  {
    date: '2026-10-24', time: '14:00', name: 'Live Space Cafe & Bar ROADIE',
    video: 'https://youtu.be/kHdosslnuB4',
    setlist: ['Welcome to the Jungle', 'Mr. Brownstone', 'Out Ta Get Me', 'Civil War', 'Patience', 'Sweet Child O’ Mine', 'Nightrain', 'Paradise City（Encore）'],
  },
  {
    date: '2026-10-03', time: '18:50', name: 'いわき街なかコンサート2026',
    video: 'https://youtu.be/ThGepKp0piw',
    setlist: ['Welcome to the Jungle', 'Mr. Brownstone', 'Out Ta Get Me', 'Sweet Child O’ Mine', 'Nightrain'],
  },
  {
    date: '2026-09-05', name: 'JAS FESTIVAL', place: '榴岡公園野外音楽堂',
    setlist: ['It’s So Easy', 'Out Ta Get Me', 'Welcome to the Jungle', 'Knockin’ on Heaven’s Door', 'Sweet Child O’ Mine', 'Nightrain', 'Paradise City'],
  },
  {
    date: '2026-06-27', time: '17:10', name: '松島パークフェスティバル', place: '松島',
    video: 'https://youtu.be/SIkXc8nU0h8',
    setlist: ['Nightrain', 'Out Ta Get Me', 'Anything Goes', 'Don’t Cry', 'Welcome to the Jungle', 'Sweet Child O’ Mine'],
  },
  {
    date: '2026-06-20', time: '14:20', name: 'ドラキュラロックフェス', place: '宇都宮市バンバ市民広場',
    video: 'https://youtu.be/3uptCsDCCR4',
    setlist: ['Welcome to the Jungle', 'Mr. Brownstone', 'Nightrain', 'Sweet Child O’ Mine', 'Paradise City'],
  },
  {
    date: '2026-05-30', time: '18:00', name: '吉フェス鳥7020', place: '小松島コミュニティーセンター',
    video: 'https://youtu.be/DEOXLTaX15w',
    setlist: ['Welcome to the Jungle', 'Mr. Brownstone', 'You Could Be Mine', 'Sweet Child O’ Mine', 'Nightrain'],
  },
  {
    date: '2026-03-29', time: '14:00', name: 'cafe polka',
    video: 'https://youtu.be/9ItrwiPrj_8',
    setlist: ['Welcome to the Jungle', 'Out Ta Get Me', 'You Could Be Mine', 'Don’t Cry', 'Patience', 'Rocket Queen', 'Knockin’ on Heaven’s Door', 'Sweet Child O’ Mine', 'Nightrain', 'Paradise City'],
  },
  {
    date: '2026-03-07', time: '20:00', name: '井垣さんLive', place: 'ロック焼き鳥吉鳥',
    setlist: ['Welcome to the Jungle', 'Out Ta Get Me', 'You Could Be Mine', 'Don’t Cry', 'Rocket Queen', 'Knockin’ on Heaven’s Door', 'Sweet Child O’ Mine', 'Nightrain'],
  },
  {
    date: '2026-01-11', time: '13:45', name: 'AMABAN Circuit Festival', place: 'Live House enn 2nd',
    video: 'https://youtu.be/Qw93KUmhvew',
    setlist: ['It’s So Easy', 'Mr. Brownstone', 'Out Ta Get Me', 'Sweet Child O’ Mine', 'Welcome to the Jungle', 'Nightrain'],
  },
].map((event) => ({ ...event, id: `sample-${event.date}` }));
const tokyoDate = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
});
const upcoming = element('liveItems');
const pastOptions = element('pastOptions');
const pastEditor = element('pastEditor');
const pastStatus = element('pastStatus');
const pastSave = element('savePast');
const showMore = element('morePast');
const fileInput = element('photoFile');
const saveButton = element('applyAll');
const emptyPhotos = () => ({ top: null, gallery: [] });
const removedUpcoming = new Set();
let photos = emptyPhotos();
let previewUrls = [];
let plan = 'normal';
let toastTimer;
let pastLimit = 3;
let editingPast;
let saving = false;
let storageAvailable = ownerMode;
let displayedContent;

function status(message, isError = false, box = element('formStatus')) {
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

const eventFields = `
  <div class="fieldrow">
    <label class="field">開催日<input name="date" type="date"></label>
    <label class="field">時間<input name="time" type="time"></label>
  </div>
  <label class="field">イベント名<input name="name" maxlength="150" placeholder="イベント名"></label>
  <label class="field">会場<input name="place" maxlength="150" placeholder="会場"></label>
  <label class="field">イベント詳細<textarea name="detail" maxlength="2000"></textarea></label>`;

function eventId() {
  return crypto.randomUUID?.() ?? crypto.getRandomValues(new Uint32Array(4)).join('-');
}

function fillEventFields(container, values) {
  container.querySelectorAll('[name]').forEach((field) => {
    const value = values[field.name];
    field.value = Array.isArray(value) ? value.join('\n') : value ?? '';
  });
}

function readEventFields(container) {
  return Object.fromEntries([...container.querySelectorAll('[name]')].map((field) => [field.name, field.value.trim()]));
}

function addUpcoming(values = {}) {
  const row = document.createElement('div');
  row.className = 'live-entry';
  row.dataset.eventId = values.id ?? eventId();
  row.innerHTML = `
    <div class="live-entry-head"><b>ライブ予定</b><button type="button" class="remove-live">削除</button></div>
    ${eventFields}`;
  fillEventFields(row, values);
  row.addEventListener('input', () => { row.dataset.edited = ''; });
  row.querySelector('.remove-live').onclick = () => {
    if (saving) return;
    removedUpcoming.add(row.dataset.eventId);
    row.remove();
  };
  upcoming.append(row);
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

function validateEvent(values) {
  if (ownerMode && (!values.date || !values.name)) throw new Error('ライブの開催日とイベント名を入力してください。');
}

function archiveEnded(draft) {
  const parts = Object.fromEntries(tokyoDate.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  const today = [parts.year, parts.month, parts.day].join('-');
  const ended = draft.upcoming.filter((event) => event.date && event.date < today);
  if (!ended.length) return draft;
  const endedIds = new Set(ended.map((event) => event.id));
  return {
    ...draft,
    upcoming: draft.upcoming.filter((event) => !endedIds.has(event.id)),
    past: [...draft.past, ...ended],
  };
}

function restoreDraft(draft) {
  const withIds = (events, section) => events.map((event, index) => (
    event.id ? event : { ...event, id: `original-${section}-${index}` }
  ));
  return archiveEnded({ ...draft, upcoming: withIds(draft.upcoming, 'upcoming'), past: withIds(draft.past, 'past') });
}

function compareEvents(a, b) {
  return (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '').localeCompare(b.time ?? '');
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
  const ordered = [...entries].sort(past ? (a, b) => compareEvents(b, a) : compareEvents);
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
      photos = index === 0
        ? { ...photos, top: null }
        : { ...photos, gallery: photos.gallery.filter((_, position) => position !== index - 1) };
      renderPhotos();
      status('写真の削除を下書きに保存してください。');
    };
  });
}

function selectPastChoice() {
  for (const button of pastOptions.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.eventId === editingPast?.id));
  }
}

function archiveTitle(event) {
  return [event.date?.replaceAll('-', '/'), event.name].filter(Boolean).join(' ') || '過去ライブを編集';
}

function editPast(event) {
  if (saving) return;
  pastEditor.reset();
  fillEventFields(pastEditor, event ?? {});
  editingPast = { id: event?.id ?? eventId(), isNew: !event, original: readEventFields(pastEditor) };
  element('pastTitle').textContent = event ? archiveTitle(event) : '過去ライブを追加';
  element('pastMeta').open = !event;
  element('pastDeleteLabel').hidden = !event;
  pastEditor.hidden = false;
  selectPastChoice();
  status('', false, pastStatus);
  pastEditor.querySelector(event ? '[name="setlist"]' : '[name="date"]').focus();
}

function renderPastOptions() {
  const events = [...current.past].sort((a, b) => compareEvents(b, a));
  pastOptions.replaceChildren();
  for (const event of events.slice(0, pastLimit)) {
    const item = document.createElement('li');
    const button = addText(item, 'button', '');
    button.type = 'button';
    button.className = 'archive-choice';
    button.dataset.eventId = event.id;
    button.setAttribute('aria-controls', 'pastEditor');
    if (event.date) addText(button, 'time', event.date.replaceAll('-', '/')).dateTime = event.date;
    addText(button, 'b', event.name || '過去ライブ');
    button.onclick = () => editPast(event);
    pastOptions.append(item);
  }
  selectPastChoice();
  element('pastEmpty').hidden = events.length > 0;
  showMore.hidden = events.length <= pastLimit;
}

function renderLives() {
  const endedIds = new Set(current.past.map((event) => event.id));
  // An unsaved form edit may still correct the event's date across midnight.
  for (const row of upcoming.querySelectorAll('.live-entry:not([data-edited])')) {
    if (endedIds.has(row.dataset.eventId)) row.remove();
  }
  if (!upcoming.firstElementChild) addUpcoming();
  renderEvents(current.upcoming, element('liveList'), false);
  element('archivePreview').hidden = !ownerMode && !current.past.length;
  renderEvents(current.past, element('pastList'), true);
  renderPastOptions();
}

function showUpcoming() {
  upcoming.replaceChildren();
  for (const event of current.upcoming.length ? current.upcoming : [{}]) addUpcoming(event);
  removedUpcoming.clear();
}

function refreshEndedLives() {
  if (saving) return;
  const draft = archiveEnded(current);
  if (draft === current) return;
  current = draft;
  renderLives();
}

function showContent() {
  const { notice, other, photos: savedPhotos } = current;
  displayedContent = { notice, other, photos: savedPhotos };
  photos = savedPhotos;
  element('noticeText').value = notice;
  element('otherRequest').value = other;
  element('pNotice').textContent = notice;
  element('pNotice').hidden = !notice;
  const otherPreview = element('otherPreview');
  otherPreview.textContent = other ? '更新要望: ' + other : '';
  otherPreview.style.display = other ? 'block' : 'none';
  renderPhotos();
}

function removeEvents(draft, ids) {
  const keep = (event) => !ids.has(event.id);
  return { ...draft, upcoming: draft.upcoming.filter(keep), past: draft.past.filter(keep) };
}

async function accessDraft(update) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sho-guns-n-loses-update-demo', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブで確認画面を使用中です。'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('drafts', update ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('drafts');
      const request = store.get('current');
      let result;
      let failure;
      request.onsuccess = () => {
        result = request.result ? restoreDraft(request.result) : null;
        if (!update) return;
        try {
          result = update(result ?? current);
          store.put(result, 'current');
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('下書きの保存が中断されました。'));
    });
  } finally { database.close(); }
}

async function applyDraft(update, box, message, afterSave) {
  if (saving) return;
  saving = true;
  saveButton.disabled = true;
  pastSave.disabled = true;
  try {
    const next = (draft) => archiveEnded(update(draft));
    current = storageAvailable ? await accessDraft(next) : next(current);
    afterSave();
    renderLives();
    if (ownerMode && !storageAvailable) {
      status('サイト見本に反映しました。ブラウザへの下書き保存は利用できません。', true, box);
    } else {
      status(message, false, box);
      toast(message);
    }
  } catch (error) {
    const message = error instanceof DOMException
      ? '下書きを保存できませんでした。ブラウザの保存設定や画像の容量を確認してください。'
      : error.message;
    status(message, true, box);
  } finally {
    saving = false;
    saveButton.disabled = false;
    pastSave.disabled = false;
  }
}

function closePastEditor() {
  pastEditor.hidden = true;
  editingPast = undefined;
  selectPastChoice();
}

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
  current = { ...current, upcoming: [], past: samplePast, notice: '' };
  try { current = await accessDraft() ?? current; }
  catch {
    storageAvailable = false;
    status('このブラウザでは下書きの保存を開けませんでした。', true);
  }
}
current = restoreDraft(current);
element('pastEventFields').innerHTML = eventFields;
showUpcoming();
showContent();
renderLives();

element('addLive').onclick = () => {
  if (!saving) addUpcoming().querySelector('input').focus();
};
element('addPast').onclick = () => editPast();
element('closePast').onclick = () => {
  if (saving) return;
  const choice = [...pastOptions.querySelectorAll('button')].find((button) => button.dataset.eventId === editingPast?.id);
  closePastEditor();
  status('', false, pastStatus);
  (choice ?? element('addPast')).focus();
};
showMore.onclick = () => {
  const firstNewIndex = pastLimit;
  pastLimit += 5;
  renderPastOptions();
  pastOptions.children[firstNewIndex]?.firstElementChild.focus();
};

pastEditor.onsubmit = (event) => {
  event.preventDefault();
  if (!editingPast || saving) return;
  const { id, original, isNew } = editingPast;
  const remove = !isNew && element('pastDelete').checked;
  const fields = readEventFields(pastEditor);
  const patch = Object.fromEntries(Object.entries(fields).filter(([key, value]) => isNew || value !== original[key]));
  try {
    if (!remove) {
      validateEvent(fields);
      if (Object.hasOwn(patch, 'video')) patch.video = videoUrl(patch.video);
      if (Object.hasOwn(patch, 'setlist')) patch.setlist = patch.setlist.split('\n').map((song) => song.trim()).filter(Boolean);
    }
  } catch (error) {
    status(error.message, true, pastStatus);
    return;
  }
  const message = remove ? '過去ライブを削除しました。'
    : ownerMode ? '過去ライブの下書きを保存しました。' : '過去ライブをサイト見本に反映しました。';
  void applyDraft((draft) => {
    const existing = draft.past.find((item) => item.id === id);
    if (!isNew && !existing) throw new Error('過去ライブの情報が変わりました。画面を再読み込みして確認してください。');
    const next = removeEvents(draft, new Set([id]));
    if (!remove) next.past.push({ ...existing, ...patch, id });
    return next;
  }, pastStatus, message, () => {
    if (remove) {
      closePastEditor();
      element('addPast').focus();
      return;
    }
    const saved = current.past.find((item) => item.id === id);
    fillEventFields(pastEditor, saved);
    editingPast = { id, isNew: false, original: readEventFields(pastEditor) };
    element('pastTitle').textContent = archiveTitle(saved);
    element('pastDeleteLabel').hidden = false;
  });
};

saveButton.onclick = () => {
  const edits = [];
  const removed = new Set(removedUpcoming);
  const content = {};
  const canEditOther = plan !== 'live';
  try {
    for (const row of upcoming.querySelectorAll('[data-edited]')) {
      const fields = readEventFields(row);
      const id = row.dataset.eventId;
      removed.add(id);
      if (!Object.values(fields).some(Boolean)) continue;
      validateEvent(fields);
      edits.push({ ...fields, id });
    }
    if (canEditOther) {
      if (fileInput.files.length || photos !== displayedContent.photos) content.photos = draftPhotos();
      for (const [key, id] of [['notice', 'noticeText'], ['other', 'otherRequest']]) {
        const value = element(id).value.trim();
        if (value !== displayedContent[key]) content[key] = value;
      }
    }
  } catch (error) {
    status(error.message, true);
    return;
  }
  const message = ownerMode ? 'このブラウザに下書きを保存しました。' : 'まとめて更新を反映しました。';
  void applyDraft((draft) => {
    const base = new Map([...draft.upcoming, ...draft.past].map((item) => [item.id, item]));
    const next = removeEvents(draft, removed);
    next.upcoming.push(...edits.map((edit) => ({ ...base.get(edit.id), ...edit })));
    return { ...next, ...content };
  }, element('formStatus'), message, () => {
    showUpcoming();
    if (canEditOther) {
      fileInput.value = '';
      showContent();
    }
  });
};

for (const id of ['addLive', 'addPast', 'applyAll']) element(id).disabled = false;
element('pastItems').addEventListener('toggle', refreshEndedLives);
window.addEventListener('pageshow', refreshEndedLives);
document.addEventListener('visibilitychange', refreshEndedLives);
window.setInterval(refreshEndedLives, 30_000);
