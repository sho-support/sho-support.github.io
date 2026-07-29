import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const emailInput = document.querySelector('#email');
const button = document.querySelector('#loginBtn');
const message = document.querySelector('#message');

async function getClient() {
  const response = await fetch('/api/public-config');
  if (!response.ok) throw new Error('ログイン設定を読み込めませんでした。');
  const config = await response.json();
  return createClient(config.supabaseUrl, config.supabaseAnonKey);
}

button.addEventListener('click', async () => {
  const email = emailInput.value.trim().toLowerCase();
  if (!email) { message.textContent = 'メールアドレスを入力してください。'; return; }
  button.disabled = true;
  message.textContent = '送信しています…';
  try {
    const supabase = await getClient();
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
    message.textContent = '送信できませんでした。設定またはメールアドレスを確認してください。';
  } finally {
    button.disabled = false;
  }
});
