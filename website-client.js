import {
  createClient,
  FunctionsHttpError,
  FunctionsFetchError,
  FunctionsRelayError,
} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './member-config.js';

export const websiteSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

async function functionError(error, fallback='処理に失敗しました。') {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      return payload?.error || fallback;
    } catch {
      return fallback;
    }
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return 'サーバーへ接続できませんでした。時間を置いて再度お試しください。';
  }
  return error?.message || fallback;
}

export async function websiteApi(action, payload={}) {
  const { data, error } = await websiteSupabase.functions.invoke('website-api', {
    body: { action, ...payload },
  });
  if (error) throw new Error(await functionError(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function currentSession() {
  const { data, error } = await websiteSupabase.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export async function requireWebsiteSession(returnUrl=location.href) {
  const session = await currentSession();
  if (session) return session;
  const login = new URL('website-login.html', location.href);
  login.searchParams.set('next', returnUrl);
  location.replace(login.href);
  return null;
}

export async function uploadWebsiteFile(siteId, file, folder='files') {
  const session = await currentSession();
  if (!session) throw new Error('ログインが必要です。');
  const safeName = String(file.name || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(-100);
  const path = `${siteId}/${session.user.id}/${folder}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await websiteSupabase.storage
    .from('website-intake-files')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return path;
}
