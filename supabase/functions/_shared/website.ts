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

let cachedLineToken = '';
let cachedLineTokenUntil = 0;

async function getLineAccessToken() {
  const fixed = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || '';
  if (fixed) return fixed;

  const now = Date.now();
  if (cachedLineToken && now < cachedLineTokenUntil) return cachedLineToken;

  const clientId = Deno.env.get('LINE_CHANNEL_ID') || '';
  const clientSecret = Deno.env.get('LINE_CHANNEL_SECRET') || '';
  if (!clientId || !clientSecret) return '';

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetch('https://api.line.me/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    console.error('LINE token issue failed', response.status, await response.text());
    return '';
  }

  const data = await response.json().catch(() => ({}));
  cachedLineToken = String(data?.access_token || '');
  const expiresIn = Math.max(60, Number(data?.expires_in || 900));
  cachedLineTokenUntil = now + Math.max(60, expiresIn - 60) * 1000;
  return cachedLineToken;
}

export async function getLineMessagingToken() {
  return getLineAccessToken();
}

export async function linePush(to: string | null | undefined, text: string) {
  const token = await getLineAccessToken();
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
  let ownerUserId = Deno.env.get('LINE_OWNER_USER_ID') || '';
  if (!ownerUserId) {
    try {
      const admin = adminClient();
      const { data } = await admin.from('website_settings').select('value').eq('key', 'line_owner').maybeSingle();
      ownerUserId = String(data?.value?.user_id || '');
    } catch (error) {
      console.error('Failed to resolve LINE owner user ID', error);
    }
  }
  return linePush(ownerUserId, text);
}


export async function triggerWebsiteWorker(siteId: string) {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) {
    console.error('website-worker trigger skipped: Supabase server secrets are missing.');
    return { ok: false, skipped: true };
  }
  const response = await fetch(`${url}/functions/v1/website-worker`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site_id: siteId }),
  });
  if (!response.ok) {
    console.error('website-worker trigger failed', response.status, await response.text());
    return { ok: false, status: response.status };
  }
  return { ok: true };
}


function githubHeaders() {
  const token = Deno.env.get('GITHUB_PAGES_TOKEN');
  if (!token) throw new Error('GITHUB_PAGES_TOKEN is missing.');
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2026-03-10',
    'Content-Type': 'application/json',
  };
}

function parseRepo(repoFullName: string) {
  const match = String(repoFullName || '').match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error('Invalid GitHub repository name.');
  return { owner: match[1], repo: match[2] };
}

export async function setGithubPagesSource(repoFullName: string, branch = 'main', path: '/' | '/docs' = '/') {
  const { owner, repo } = parseRepo(repoFullName);
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pages`;
  const headers = githubHeaders();
  // Draft sites are kept in private repositories. Publishing requires a public Pages repository.
  if (path === '/') {
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const infoResponse = await fetch(repoUrl, { headers });
    if (!infoResponse.ok) throw new Error(`GitHub repository lookup failed: ${infoResponse.status}`);
    const info = await infoResponse.json();
    if (info.private) {
      const visibility = await fetch(repoUrl, {
        method: 'PATCH', headers,
        body: JSON.stringify({ private: false }),
      });
      if (!visibility.ok) throw new Error(`GitHub repository publish failed: ${visibility.status} ${(await visibility.text()).slice(0,300)}`);
    }
  }
  const current = await fetch(base, { headers });

  if (current.status === 404) {
    const created = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({ build_type: 'legacy', source: { branch, path } }),
    });
    if (!created.ok) throw new Error(`GitHub Pages create failed: ${created.status} ${await created.text()}`);
    return await created.json().catch(() => ({}));
  }

  if (!current.ok) throw new Error(`GitHub Pages read failed: ${current.status} ${await current.text()}`);

  const updated = await fetch(base, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ build_type: 'legacy', source: { branch, path } }),
  });
  if (!updated.ok) throw new Error(`GitHub Pages update failed: ${updated.status} ${await updated.text()}`);
  return { ok: true };
}

export async function setGithubPagesDomain(repoFullName: string, cname: string | null) {
  const { owner, repo } = parseRepo(repoFullName);
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pages`,
    {
      method: 'PUT',
      headers: githubHeaders(),
      body: JSON.stringify({ cname: cname || null }),
    },
  );
  if (!response.ok) throw new Error(`GitHub Pages domain update failed: ${response.status} ${await response.text()}`);
  return { ok: true };
}
