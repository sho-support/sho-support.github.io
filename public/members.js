import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const loading = document.querySelector('#loading');
const locked = document.querySelector('#locked');
const lockedMessage = document.querySelector('#lockedMessage');
const memberArea = document.querySelector('#memberArea');
const memberMeta = document.querySelector('#memberMeta');
const videoGrid = document.querySelector('#videoGrid');

let supabase;

async function getConfig() {
  const response = await fetch('/api/public-config', { cache: 'no-store' });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error || '設定を読み込めませんでした。');
  return config;
}

function applyOfficialLinks(officialSiteUrl) {
  const base = String(officialSiteUrl || 'https://sho-support.github.io').replace(/\/$/, '');
  document.querySelectorAll('[data-official-home]').forEach(link => { link.href = `${base}/`; });
  document.querySelectorAll('[data-support-page]').forEach(link => { link.href = `${base}/support-us.html`; });
}

function showLocked(message) {
  loading.classList.add('hidden');
  memberArea.classList.add('hidden');
  locked.classList.remove('hidden');
  lockedMessage.textContent = message;
}

function safeVideoUrl(value) {
  try {
    const url = new URL(value);
    const allowedHosts = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
    if (!allowedHosts.has(url.hostname) || !url.pathname.startsWith('/embed/')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function renderVideos(videos) {
  videoGrid.replaceChildren();
  const validVideos = videos.filter(video => safeVideoUrl(video.videoUrl));
  videoGrid.classList.toggle('is-empty', validVideos.length === 0);

  if (!validVideos.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<strong>COMING SOON</strong><p>最初の限定コンテンツを準備しています。</p>';
    videoGrid.append(empty);
    return;
  }

  for (const video of validVideos) {
    const card = document.createElement('article');
    card.className = 'video-card';

    const iframe = document.createElement('iframe');
    iframe.className = 'video-frame';
    iframe.src = safeVideoUrl(video.videoUrl);
    iframe.title = video.title || '限定動画';
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;

    const copy = document.createElement('div');
    copy.className = 'video-copy';
    const title = document.createElement('h2');
    title.textContent = video.title || '限定動画';
    const description = document.createElement('p');
    description.textContent = video.description || '';
    copy.append(title, description);

    if (video.publishedAt) {
      const date = document.createElement('time');
      date.className = 'video-date';
      date.dateTime = video.publishedAt;
      date.textContent = video.publishedAt;
      copy.append(date);
    }
    card.append(iframe, copy);
    videoGrid.append(card);
  }
}

function formatMemberMeta(status) {
  const parts = [status.email];
  if (Number.isFinite(Number(status.planAmount)) && Number(status.planAmount) > 0) {
    parts.push(`月額 ¥${Number(status.planAmount).toLocaleString('ja-JP')}`);
  }
  if (status.cancelAtPeriodEnd && status.currentPeriodEnd) {
    const end = new Date(status.currentPeriodEnd);
    if (!Number.isNaN(end.getTime())) parts.push(`${end.toLocaleDateString('ja-JP')}まで有効`);
  }
  return parts.join(' / ');
}

async function logout() {
  if (supabase) await supabase.auth.signOut();
  location.replace('/member-login.html');
}

document.querySelector('#logoutBtn').addEventListener('click', logout);
document.querySelector('#logoutLocked').addEventListener('click', logout);

async function initialize() {
  try {
    const config = await getConfig();
    applyOfficialLinks(config.officialSiteUrl);
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      location.replace('/member-login.html');
      return;
    }

    const headers = { Authorization: `Bearer ${session.access_token}` };
    const statusResponse = await fetch('/api/member-status', { headers, cache: 'no-store' });
    const status = await statusResponse.json();
    if (!statusResponse.ok || !status.active) {
      showLocked(status.error || '有効な月額サポートを確認できません。決済時と同じメールアドレスか確認してください。');
      return;
    }

    const videosResponse = await fetch('/api/member-videos', { headers, cache: 'no-store' });
    const payload = await videosResponse.json();
    if (!videosResponse.ok) throw new Error(payload.error || '動画を取得できませんでした。');

    loading.classList.add('hidden');
    locked.classList.add('hidden');
    memberArea.classList.remove('hidden');
    memberMeta.textContent = formatMemberMeta(status);
    renderVideos(Array.isArray(payload.videos) ? payload.videos : []);
  } catch (error) {
    console.error(error);
    showLocked('会員ページを読み込めませんでした。時間をおいて再度お試しください。');
  }
}

initialize();
