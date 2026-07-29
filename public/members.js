import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const loading = document.querySelector('#loading');
const locked = document.querySelector('#locked');
const lockedMessage = document.querySelector('#lockedMessage');
const memberArea = document.querySelector('#memberArea');
const memberMeta = document.querySelector('#memberMeta');
const videoGrid = document.querySelector('#videoGrid');

async function getClient() {
  const response = await fetch('/api/public-config');
  if (!response.ok) throw new Error('設定を読み込めませんでした。');
  const config = await response.json();
  return createClient(config.supabaseUrl, config.supabaseAnonKey);
}

function showLocked(message) {
  loading.classList.add('hidden');
  memberArea.classList.add('hidden');
  locked.classList.remove('hidden');
  lockedMessage.textContent = message;
}

function renderVideos(videos) {
  videoGrid.innerHTML = '';
  for (const video of videos) {
    const card = document.createElement('article');
    card.className = 'video-card';
    const iframe = document.createElement('iframe');
    iframe.className = 'video-frame';
    iframe.src = video.videoUrl;
    iframe.title = video.title;
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    const copy = document.createElement('div');
    copy.className = 'video-copy';
    const title = document.createElement('h2'); title.textContent = video.title;
    const description = document.createElement('p'); description.textContent = video.description || '';
    copy.append(title, description); card.append(iframe, copy); videoGrid.append(card);
  }
}

async function init() {
  try {
    const supabase = await getClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { location.replace('/member-login.html'); return; }

    const headers = { Authorization: `Bearer ${session.access_token}` };
    const statusResponse = await fetch('/api/member-status', { headers });
    const status = await statusResponse.json();
    if (!statusResponse.ok || !status.active) {
      showLocked('有効な月額サポートを確認できません。決済時と同じメールアドレスか確認してください。');
      return;
    }

    const videosResponse = await fetch('/api/member-videos', { headers });
    const payload = await videosResponse.json();
    if (!videosResponse.ok) throw new Error(payload.error || '動画を取得できませんでした。');

    loading.classList.add('hidden');
    locked.classList.add('hidden');
    memberArea.classList.remove('hidden');
    memberMeta.textContent = `${status.email} / 月額 ¥${Number(status.planAmount || 0).toLocaleString('ja-JP')}`;
    renderVideos(payload.videos || []);

    const logout = async () => { await supabase.auth.signOut(); location.replace('/member-login.html'); };
    document.querySelector('#logoutBtn').addEventListener('click', logout);
    document.querySelector('#logoutLocked').addEventListener('click', logout);
  } catch (error) {
    console.error(error);
    showLocked('会員ページを読み込めませんでした。時間をおいて再度お試しください。');
  }
}

init();
