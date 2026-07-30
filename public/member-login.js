import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const form = document.querySelector('#loginForm');
const emailInput = document.querySelector('#email');
const button = document.querySelector('#loginBtn');
const message = document.querySelector('#message');
const sessionBox = document.querySelector('#sessionBox');

let supabase;

async function getConfig() {
  const response = await fetch('/api/public-config', { cache: 'no-store' });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error || 'ログイン設定を読み込めませんでした。');
  return config;
}

function applyOfficialLinks(officialSiteUrl) {
  const base = String(officialSiteUrl || 'https://sho-support.github.io').replace(/\/$/, '');
  document.querySelectorAll('[data-official-home]').forEach(link => { link.href = `${base}/`; });
  document.querySelectorAll('[data-support-page]').forEach(link => { link.href = `${base}/support-us.html`; });
}

async function initialize() {
  try {
    const config = await getConfig();
    applyOfficialLinks(config.officialSiteUrl);
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) sessionBox.classList.remove('hidden');
  } catch (error) {
    console.error(error);
    message.textContent = 'ログイン設定を読み込めませんでした。管理者へお問い合わせください。';
    button.disabled = true;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const email = emailInput.value.trim().toLowerCase();
  if (!email || !emailInput.validity.valid) {
    message.textContent = '正しいメールアドレスを入力してください。';
    emailInput.focus();
    return;
  }
  if (!supabase) {
    message.textContent = 'ログイン設定を読み込んでいます。少し待ってから再度お試しください。';
    return;
  }

  button.disabled = true;
  message.textContent = '送信しています…';
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/members.html`,
        shouldCreateUser: true
      }
    });
    if (error) throw error;
    message.textContent = 'ログイン用メールを送信しました。メール内のリンクを開いてください。';
  } catch (error) {
    console.error(error);
    message.textContent = '送信できませんでした。時間をおいて再度お試しください。';
  } finally {
    button.disabled = false;
  }
});

initialize();
