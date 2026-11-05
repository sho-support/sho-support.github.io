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

export async function linePush(to: string | null | undefined, text: string, retryKey?: string) {
  const token = await getLineAccessToken();
  if (!token || !to) return { skipped: true };
  const headers: Record<string,string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  // LINE recognizes the same X-Line-Retry-Key for 24 hours. The caller must
  // persist/reuse this UUID for an identical request, not generate a new one on retry.
  if(retryKey){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(retryKey))
      throw new Error('LINE retry key must be a UUID');
    headers['X-Line-Retry-Key']=retryKey;
  }
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers,
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 5000) }] }),
    signal: AbortSignal.timeout(13000),
  });
  // A 409 with accepted-request-id is proof that LINE accepted the same retry key
  // previously; it does NOT mean the end user definitely saw the message.
  if(retryKey && response.status===409 && response.headers.has('x-line-accepted-request-id'))
    return { skipped:false, ok:true, alreadyAccepted:true };
  if (!response.ok) {
    console.error('LINE push failed', response.status, await response.text());
    return { skipped: false, ok: false, status: response.status };
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


export async function verifyWebsiteBeforeDelivery(repoFullName: string, branch = 'main', expectedSemiTheme = '') {
  const {owner,repo}=parseRepo(repoFullName);
  const base='https://api.github.com/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo);
  const headers=githubHeaders();
  const [treeResponse,htmlResponse]=await Promise.all([
    fetch(base+'/git/trees/'+encodeURIComponent(branch)+'?recursive=1',{headers}),
    fetch(base+'/contents/index.html?ref='+encodeURIComponent(branch),{
      headers:{...headers,Accept:'application/vnd.github.raw+json'}
    })
  ]);
  if(!treeResponse.ok||!htmlResponse.ok)throw new Error('公開前検査：GitHubの制作ファイルを取得できません。');
  const tree=await treeResponse.json();
  if(tree.truncated)throw new Error('公開前検査：ファイル一覧が多すぎるため確認できません。');
  const files=new Map<string,number>((tree.tree||[]).filter((x:any)=>x.type==='blob').map((x:any)=>[x.path,Number(x.size||0)]));
  if(!files.has('index.html'))throw new Error('公開前検査：index.html がありません。');
  const html=await htmlResponse.text();
  if(!/<html\b/i.test(html)||!/<body\b/i.test(html)||html.length<350)throw new Error('公開前検査：ホームページのHTMLが不正です。');
  if(!/name\s*=\s*["']viewport["']/i.test(html))throw new Error('公開前検査：スマホ表示の指定がありません。');
  if(expectedSemiTheme&&!html.includes('data-theme="'+expectedSemiTheme+'"'))throw new Error('公開前検査：選択したテンプレートのデザインと一致しません。');
  const missing:string[]=[];
  let cssFound=/<style\b/i.test(html);
  const verify=(ref:string,kind:string)=>{
    if(!ref.trim()){missing.push(kind+' の参照が空です');return}
    if(/^(?:https?:|data:|blob:|mailto:|tel:|#|\/\/)/i.test(ref))return;
    try{
      const parsed=new URL(ref,'https://local.invalid/');
      if(parsed.origin!=='https://local.invalid')return;
      const path=decodeURIComponent(parsed.pathname.slice(1));
      if(!path||path.includes('..')||!files.has(path)||files.get(path)===0)missing.push(kind+': '+path);
    }catch{missing.push(kind+' のパスが不正です');}
  };
  for(const match of html.matchAll(/<img\b[^>]*>/gi)){
    const ref=match[0].match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1];
    if(ref===undefined)missing.push('画像の参照がありません');else verify(ref,'画像');
  }
  for(const match of html.matchAll(/<script\b[^>]*>/gi)){
    const ref=match[0].match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1];
    if(ref!==undefined)verify(ref,'動作ファイル');
  }
  for(const match of html.matchAll(/<link\b[^>]*>/gi)){
    const tag=match[0];
    if(!/\brel\s*=\s*["'][^"']*\bstylesheet\b/i.test(tag))continue;
    cssFound=true;
    const ref=tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1];
    if(ref===undefined)missing.push('CSSの参照がありません');else verify(ref,'CSS');
  }
  if(!cssFound)missing.push('スタイルシートがありません');

  // Every page must be safe to publish, not only index.html. Prevent AI-generated
  // preview/review URLs (including access tokens) leaking after repo turns public.
  const pages=[...files.keys()].filter(p=>/^[a-z0-9-]+\.html$/i.test(p)).slice(0,20);
  const forbidden=/(?:https?:\/\/sho-support\.github\.io\/(?:website-(?:preview|customer-review|intake|login|update|order-confirm)\.html|admin\/))|(?:website-(?:preview|customer-review|intake)\.html[^"'<>]{0,500}(?:[?&](?:amp;)?(?:key|token)=))/i;
  const checked=await Promise.all(pages.map(async p=>{
    if(p==='index.html')return {path:p,html};
    const url=base+'/contents/'+p+'?ref='+encodeURIComponent(branch);
    const r=await fetch(url,{headers:{...headers,Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(14000)});
    if(!r.ok)throw new Error('公開前検査：'+p+' を取得できません。');
    return {path:p,html:await r.text()};
  }));
  for(const {path,html:doc} of checked){
    if(forbidden.test(doc))missing.push(path+' に制作管理用リンクが含まれています');
    for(const hit of doc.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi)){
      const ref=hit[1].replace(/&amp;/gi,'&').trim();
      if(!ref||ref==='#'||/^(?:javascript:|data:|\/\/)/i.test(ref)){
        missing.push(path+' に無効なリンクがあります');continue;
      }
      if(/^(?:https?:|mailto:|tel:|#)/i.test(ref))continue;
      try{
        const parsed=new URL(ref,'https://local.invalid/');
        if(parsed.origin!=='https://local.invalid')continue;
        const target=decodeURIComponent(parsed.pathname.slice(1));
        if(!target||target.includes('..')||!files.has(target))missing.push(path+' のリンク先がありません: '+target);
      }catch{missing.push(path+' に不正なリンクがあります');}
    }
    for(const hit of doc.matchAll(/<(?:img|script)\b[^>]*\bsrc\s*=\s*["']([^"']*)["'][^>]*>/gi)){
      const ref=hit[1].replace(/&amp;/gi,'&');
      if(!/^(?:https?:|data:|blob:|\/\/)/i.test(ref)&&!ref.startsWith('#')){
        try{
          const target=decodeURIComponent(new URL(ref,'https://local.invalid/').pathname.slice(1));
          if(!files.has(target))missing.push(path+' の画像・動作ファイルがありません: '+target);
        }catch{missing.push(path+' のファイル参照が不正です');}
      }
    }
  }
  if(missing.length)throw new Error('公開前検査で不足が見つかりました：'+missing.slice(0,8).join(' / '));
  return {ok:true,files:files.size,inline_css:/<style\b/i.test(html)};
}

export async function publishApprovedStagedBranch(repoFullName:string,liveBranch:string,stagedBranch:string|null|undefined) {
  if(!stagedBranch)return;
  if(!/^sho-review-[a-f0-9-]{8,50}$/.test(stagedBranch)||stagedBranch===liveBranch)throw new Error('Invalid staged branch.');
  const {owner,repo}=parseRepo(repoFullName);
  const response=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/merges`,{
    method:'POST',
    headers:githubHeaders(),
    body:JSON.stringify({base:liveBranch,head:stagedBranch,commit_message:'Publish customer-approved website update'}),
  });
  if(response.status!==201&&response.status!==204)throw new Error(`GitHub staged update merge failed: ${response.status} ${(await response.text()).slice(0,500)}`);
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


// Long-lived customer URLs must not belong to the current hosting provider.
export function normalizeCustomerHostname(input: unknown): string {
  const host = String(input || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error('正式公開URLが未設定です。お客様所有のドメイン、または当社管理の独自ドメイン配下のURLを設定してください。');
  if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.includes('..') ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)) {
    throw new Error('正式公開URLは https:// やパスを除いた有効なドメイン名で設定してください。');
  }
  if (/(?:^|\.)(?:github\.io|pages\.dev|vercel\.app|netlify\.app|onrender\.com|railway\.app|localhost|example\.com|example\.net|example\.org|test|invalid)$/.test(host)) {
    throw new Error('サービス提供者の無料URLやテスト用ドメインは正式公開URLに設定できません。');
  }
  return host;
}

export async function requireStablePublicationUrl(repoFullName: string, domain: unknown): Promise<string> {
  const host = normalizeCustomerHostname(domain);
  const { owner, repo } = parseRepo(repoFullName);
  const response = await fetch(
    'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/pages',
    { headers: githubHeaders(), signal: AbortSignal.timeout(12000) },
  );
  if (!response.ok) throw new Error('GitHub Pagesの設定を確認できません。ステータス: ' + response.status);
  const pages = await response.json();
  if (String(pages?.cname || '').trim().toLowerCase() !== host) {
    throw new Error('GitHub Pagesのカスタムドメイン設定が正式公開URLと一致しません。');
  }
  let publicResponse: Response;
  try {
    publicResponse = await fetch('https://' + host + '/', {
      method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(12000),
      headers: { 'Cache-Control': 'no-cache' },
    });
  } catch {
    throw new Error('正式公開URLのHTTPS接続を確認できません。DNS・SSL設定を完了してください。');
  }
  if (!publicResponse.ok || new URL(publicResponse.url).hostname.toLowerCase() !== host) {
    throw new Error('正式公開URLが正常表示されません。DNS・HTTPS・リンク先を確認してください。');
  }
  return 'https://' + host + '/';
}
