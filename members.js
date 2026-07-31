import {
  createClient,
  FunctionsHttpError,
  FunctionsFetchError,
  FunctionsRelayError,
} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './member-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const loading = document.querySelector('#loading');
const locked = document.querySelector('#locked');
const lockedMessage = document.querySelector('#lockedMessage');
const memberArea = document.querySelector('#memberArea');
const memberMeta = document.querySelector('#memberMeta');
const videoGrid = document.querySelector('#videoGrid');
const logoutButtons = [
  document.querySelector('#logoutBtn'),
  document.querySelector('#logoutLocked'),
].filter(Boolean);

function clearAuthParameters() {
  const url = new URL(location.href);
  const authKeys = ['code', 'error', 'error_code', 'error_description'];
  let changed = false;
  for (const key of authKeys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (url.hash) {
    url.hash = '';
    changed = true;
  }
  if (changed) history.replaceState({}, document.title, url.pathname + url.search);
}

function getRedirectError() {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  return search.get('error_description') || hash.get('error_description') || '';
}

function showLocked(message) {
  loading.classList.add('hidden');
  memberArea.classList.add('hidden');
  locked.classList.remove('hidden');
  lockedMessage.textContent = message;
}

function showMemberArea() {
  loading.classList.add('hidden');
  locked.classList.add('hidden');
  memberArea.classList.remove('hidden');
}

function renderComingSoon() {
  videoGrid.innerHTML = `
    <article class="coming-soon">
      <div class="state-mark">COMING SOON</div>
      <h2>限定コンテンツを準備中です</h2>
      <p>練習映像、ライブの舞台裏、未公開動画などを順次追加します。</p>
    </article>
  `;
}

function renderVideos(videos) {
  videoGrid.replaceChildren();
  if (!Array.isArray(videos) || videos.length === 0) {
    renderComingSoon();
    return;
  }

  for (const video of videos) {
    const card = document.createElement('article');
    card.className = 'video-card';

    const iframe = document.createElement('iframe');
    iframe.className = 'video-frame';
    iframe.src = video.videoUrl;
    iframe.title = video.title || 'Supporter video';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;

    const copy = document.createElement('div');
    copy.className = 'video-copy';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'video-date';
    eyebrow.textContent = video.publishedAt || 'SUPPORTER CONTENT';

    const title = document.createElement('h2');
    title.textContent = video.title || '限定動画';

    const description = document.createElement('p');
    description.textContent = video.description || '';

    copy.append(eyebrow, title, description);
    card.append(iframe, copy);
    videoGrid.append(card);
  }
}

async function readFunctionError(error, fallback) {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      return payload?.error || fallback;
    } catch {
      return fallback;
    }
  }
  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return '通信に失敗しました。時間を置いて再度お試しください。';
  }
  return error?.message || fallback;
}

async function invoke(name) {
  const { data, error } = await supabase.functions.invoke(name, {
    body: {},
  });
  if (error) {
    throw new Error(await readFunctionError(error, '会員情報を取得できませんでした。'));
  }
  return data;
}

async function logout() {
  await supabase.auth.signOut();
  location.replace(new URL('member-login.html', location.href).href);
}

for (const button of logoutButtons) {
  button.addEventListener('click', logout);
}

async function init() {
  const redirectError = getRedirectError();
  if (redirectError) {
    clearAuthParameters();
    const normalizedError = redirectError.toLowerCase();
    const expiredOrUsed =
      normalizedError.includes('invalid') ||
      normalizedError.includes('expired') ||
      normalizedError.includes('already been used');

    showLocked(
      expiredOrUsed
        ? 'ログインリンクが期限切れ、使用済み、または無効です。ログイン画面から新しいリンクを発行してください。'
        : `ログインできませんでした。${redirectError}`
    );
    return;
  }

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    clearAuthParameters();

    if (!session) {
      location.replace(new URL('member-login.html', location.href).href);
      return;
    }

    const status = await invoke('member-status');
    if (!status?.active) {
      showLocked('有効な月額サポートを確認できません。Stripe決済時と同じメールアドレスか確認してください。');
      return;
    }

    const payload = await invoke('member-videos');

    const amount = Number(status.planAmount || 0).toLocaleString('ja-JP');
    const cancelNote = status.cancelAtPeriodEnd ? ' / 期間終了時に解約予定' : '';
    memberMeta.textContent = `${status.email} / 月額 ¥${amount}${cancelNote}`;

    renderVideos(payload?.videos || []);
    showMemberArea();
  } catch (error) {
    console.error('Member page initialization failed:', error);
    showLocked(error?.message || '会員ページを読み込めませんでした。時間を置いて再度お試しください。');
  }
}

init();
