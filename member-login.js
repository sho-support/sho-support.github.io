import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './member-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const form = document.querySelector('#loginForm');
const emailInput = document.querySelector('#email');
const button = document.querySelector('#loginBtn');
const message = document.querySelector('#message');

function setMessage(text, type = '') {
  message.textContent = text;
  message.dataset.type = type;
}

async function redirectExistingSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    location.replace(new URL('members.html', location.href).href);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim().toLowerCase();
  if (!email || !emailInput.checkValidity()) {
    setMessage('正しいメールアドレスを入力してください。', 'error');
    emailInput.focus();
    return;
  }

  button.disabled = true;
  setMessage('ログイン用メールを送信しています…');

  try {
    const redirectTo = new URL('members.html', location.href).href;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
      },
    });

    if (error) throw error;

    setMessage(
      'ログイン用メールを送信しました。リンクは1回限りで、通常は送信から1時間以内に開く必要があります。受信箱と迷惑メールフォルダを確認し、届いた最新のメールを開いてください。',
      'success'
    );
    form.reset();
  } catch (error) {
    console.error('Magic-link request failed:', error);
    const unauthorizedAddress = /not authorized/i.test(error?.message || '');
    setMessage(
      unauthorizedAddress
        ? '現在、このメールアドレスへ送信できません。メール送信設定を確認してください。'
        : '送信できませんでした。少し時間を置いて、もう一度お試しください。',
      'error'
    );
  } finally {
    button.disabled = false;
  }
});

redirectExistingSession().catch((error) => {
  console.error('Session check failed:', error);
});
