import { sendJson } from './_shared.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return sendJson(res, 500, { error: 'Public Supabase configuration is missing.' });
  }
  return sendJson(res, 200, { supabaseUrl, supabaseAnonKey });
}
