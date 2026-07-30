import { createClient } from '@supabase/supabase-js';

export function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase server environment variables are missing.');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function getBearerToken(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

export async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isActiveStatus(status) {
  return status === 'active' || status === 'trialing';
}

export function sendJson(res, status, data) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}
