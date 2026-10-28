import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase server secrets are missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function bearer(req: Request) {
  const value = req.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

export async function getUser(req: Request, admin = adminClient()) {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return data.user || null;
}

export async function isAdmin(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin.from('website_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function siteRole(admin: ReturnType<typeof adminClient>, userId: string, siteId: string) {
  if (await isAdmin(admin, userId)) return 'admin';
  const { data, error } = await admin
    .from('website_site_users')
    .select('role')
    .eq('site_id', siteId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.role || null;
}

export async function linePush(to: string | null | undefined, text: string) {
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !to) return { skipped: true };
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 5000) }] }),
  });
  if (!response.ok) {
    console.error('LINE push failed', response.status, await response.text());
    return { skipped: false, ok: false };
  }
  return { skipped: false, ok: true };
}

export async function notifyOwner(text: string) {
  return linePush(Deno.env.get('LINE_OWNER_USER_ID'), text);
}
