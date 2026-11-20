import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';

const cloud = 'https://sho-web-support-preview.zodiac-suu.workers.dev';
const legacy = 'https://sho-web-support.netlify.app';
const key = 'synthetic-review-key-20261115';
const hash = value => createHash('sha256').update(value).digest('hex');
const forbidden = () => { throw Error('Unexpected database mutation or external call'); };

// Run the exact deployment entrypoints. The SDK, database, messages, and network
// are replaced at their boundaries; no real accounts or external service keys.
async function runtime(slug, { admin = { from: forbidden, rpc: forbidden }, env = {}, user = null, fetcher = forbidden, confirmedOrigin, canonical = false } = {}) {
  let handler;
  const messages = [], requests = [];
  const helpers = {
    adminClient: () => admin, getUser: async () => user,
    getLineMessagingToken: async () => 'synthetic-line-token-only',
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    json: (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }),
    notifyOwner: async text => { messages.push(text); return { ok: true }; },
    linePush: forbidden, siteRole: forbidden, triggerWebsiteWorker: forbidden,
    setGithubPagesDomain: forbidden, setGithubPagesSource: forbidden,
    publishApprovedStagedBranch: forbidden, verifyWebsiteBeforeDelivery: forbidden,
    requireStablePublicationUrl: forbidden, normalizeCustomerHostname: forbidden,
    freeWebsiteUrl: forbidden, resolveFreeWebsiteUrl: forbidden,
  };
  const vars = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-only', SUPABASE_ANON_KEY: 'synthetic-public-only', GITHUB_PAGES_TOKEN: 'synthetic-only', ...env };
  const context = vm.createContext({ Request, Response, Headers, URL, URLSearchParams, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, structuredClone, AbortSignal, crypto, atob, btoa,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: name => vars[name] }, serve: fn => { handler = fn; } },
    fetch: async (...args) => { requests.push(args); return fetcher(...args); },
  });
  const cache = new Map();
  function synthetic(id, exports) {
    if (!cache.has(id)) cache.set(id, new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context, identifier: id }));
    return cache.get(id);
  }
  async function load(url) {
    if (cache.has(url)) return cache.get(url);
    if (url.endsWith('/_shared/auth-redirect-confirmation.ts') && confirmedOrigin !== undefined) return synthetic(url, { CONFIRMED_RECOVERY_ORIGIN: confirmedOrigin });
    if (url.endsWith('/_shared/website.ts')) return synthetic(url, helpers);
    if (/^(https:\/\/esm.sh\/|npm:)@supabase\/supabase-js@2\.57\.4$/.test(url)) return synthetic(url, { createClient: () => admin });
    if (url === 'jsr:@supabase/functions-js/edge-runtime.d.ts') return synthetic(url, {});
    if (!url.startsWith('file:')) throw Error('Unapproved import: ' + url);
    const code = stripTypeScriptTypes(await readFile(new URL(url), 'utf8'));
    const module = new vm.SourceTextModule(code, { context, identifier: url });
    cache.set(url, module); return module;
  }
  const source = canonical ? '../../supabase/functions/' : '../runtime/';
  const root = await load(new URL(source + slug + '/index.ts', import.meta.url).href);
  await root.link((specifier, ref) => load(new URL(specifier, ref.identifier).href));
  await root.evaluate();
  const request = (body, origin = cloud, method = 'POST') => handler(new Request('https://fixture.supabase.co/functions/v1/' + slug, {
    method, headers: { origin, 'content-type': 'application/json', authorization: 'Bearer synthetic-client' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  }));
  return { request, handler, messages, requests };
}

function rowsFixture(tables) {
  return { from(table) {
    let where = [];
    const result = () => ({ data: (tables[table] || []).find(r => where.every(([k, v]) => r[k] === v)) || null, error: null });
    const chain = { select() { return chain; }, eq(k, v) { where.push([k, v]); return chain; }, maybeSingle: async () => result(), single: async () => result(), then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
    return chain;
  } };
}

for (const slug of ['website-order-api', 'website-customer-access', 'website-password-recovery']) {
  test(slug + ': browser preflight permits the exact Cloudflare and previous Netlify origins, including SDK Authorization', async () => {
    const h = await runtime(slug);
    for (const origin of [cloud, legacy]) {
      const response = await h.request(null, origin, 'OPTIONS');
      assert.ok([200, 204].includes(response.status));
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.match(response.headers.get('access-control-allow-headers'), /authorization/i);
    }
    assert.equal(h.messages.length, 0); assert.equal(h.requests.length, 0);
  });
  test(slug + ': spoofed origin, prefix, port, HTTP and sibling Workers cannot execute operations', async () => {
    const h = await runtime(slug);
    for (const origin of ['https://evil.invalid', cloud + '.evil.invalid', cloud + ':8443', cloud.replace('https:', 'http:'), 'https://other.zodiac-suu.workers.dev']) {
      assert.equal((await h.request({ action: 'admin_list_orders', email: 'qa@example.test' }, origin)).status, 403);
    }
    assert.equal(h.messages.length, 0); assert.equal(h.requests.length, 0);
  });
}

for (const slug of ['website-api', 'website-customer-access']) {
  test(slug + ': changing the frontend does not bypass administrator authentication', async () => {
    const h = await runtime(slug);
    for (const action of ['admin_list_orders', 'admin_invite_customer', 'admin_send_review']) {
      // API has a single early authentication guard; customer-access authenticates
      // its supported admin action group. Use its actual supported action.
      if (slug === 'website-customer-access' && action === 'admin_invite_customer') continue;
      const response = await h.request({ action });
      // The compatibility adapter also refuses new-frontend mutations while
      // the commercial schema/release is pending; either gate must fail closed.
      assert.ok([401, 409].includes(response.status));
    }
    assert.equal(h.messages.length, 0); assert.equal(h.requests.length, 0);
  });
}

test('customer review returns a Cloudflare preview link only after checking the existing customer key', async () => {
  const admin = rowsFixture({ website_sites: [{ site_id: '9000001000', site_name: 'Synthetic', status: 'customer_review', review_access_token_hash: hash(key) }] });
  const h = await runtime('website-customer-access', { admin });
  for (const [origin, expected] of [[cloud, cloud], [legacy, legacy], ['https://sho-support.github.io', legacy]]) {
    const response = await h.request({ action: 'review_load', site_id: '9000001000', key }, origin);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(new URL(body.site.preview_url).origin, expected);
    assert.equal(new URL(body.site.preview_url).searchParams.get('key'), key);
    assert.equal('review_access_token_hash' in body.site, false);
  }
  assert.equal((await h.request({ action: 'review_load', site_id: '9000001000', key: key + '-wrong' })).status, 403);
  assert.equal(h.messages.length, 0); assert.equal(h.requests.length, 0);
});

test('valid Cloudflare orders stop before DB and notification until the full commercial release is installed', async () => {
  const h = await runtime('website-order-api');
  for (const [plan, update_plan, template_style] of [['one', 'none', ''], ['semi', 'free3', 'rock'], ['full', 'free3', '']]) {
    const response = await h.request({ plan, update_plan, template_style });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'sales_release_pending');
  }
  assert.equal(h.messages.length, 0); assert.equal(h.requests.length, 0);
});

test('new frontend cannot reach legacy quote, payment-confirmation, publish, AI, or update mutations', async () => {
  for (const slug of ['website-api', 'website-customer-access']) {
    const h = await runtime(slug, { user: { id: 'synthetic-admin' } });
    for (const action of ['admin_send_final_quote', 'admin_activate_order', 'admin_publish_site', 'create_site', 'admin_run_worker', 'admin_start_update', 'submit_intake', 'request_update', 'review_approve']) {
      const response = await h.request({ action, site_id: '9000001000', key });
      assert.equal(response.status, 409); assert.equal((await response.json()).code, 'sales_release_pending');
    }
    assert.equal(h.messages.length, 0); assert.equal(h.requests.length, 0);
  }
});

test('preview HTML navigation stays on the trusted viewer without exposing keys to a foreign Origin', async () => {
  const admin = rowsFixture({ website_sites: [{ site_id: '9000001000', repo_full_name: 'fixture/synthetic', status: 'customer_review', preview_access_token_hash: hash(key) }] });
  const h = await runtime('website-preview', { admin, fetcher: async () => new Response('<a href="next.html">Next</a><img src="photo.png">', { headers: { 'content-type': 'text/html' } }) });
  for (const [origin, expected] of [[cloud, cloud], [legacy, legacy], ['https://evil.invalid', legacy]]) {
    const req = new Request(`https://fixture.supabase.co/functions/v1/website-preview?id=9000001000&key=${key}`, { headers: { origin } });
    const response = await h.handler(req); assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.html.includes(expected + '/website-preview.html?'));
    assert.ok(!body.html.includes('https://evil.invalid'));
    assert.match(body.html, /https:\/\/fixture\.supabase\.co\/functions\/v1\/website-preview/);
  }
  const denied = await h.handler(new Request('https://fixture.supabase.co/functions/v1/website-preview?id=9000001000&key=not-a-valid-customer-key', { headers: { origin: cloud } }));
  assert.equal(denied.status, 403);
  assert.equal(h.messages.length, 0);
});

test('Cloudflare recovery waits for confirmed Auth redirect configuration before consuming limits or sending mail', async () => {
  const h = await runtime('website-password-recovery', { confirmedOrigin: '' });
  const response = await h.request({ email: 'qa@example.test' });
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'auth_redirect_not_ready');
  assert.equal(h.requests.length, 0);
});

test('configured recovery uses its request origin and rejects cross-origin next URLs; legacy recovery stays available', async () => {
  const rpcCalls = [];
  const admin = { rpc: async (name, args) => { rpcCalls.push([name, args]); return { data: true, error: null }; } };
  const h = await runtime('website-password-recovery', { admin, fetcher: async () => new Response('{}') });
  for (const origin of [cloud, legacy]) {
    for (const next of [origin + '/admin/sales-settings', 'https://evil.invalid/steal', '//evil.invalid/steal']) {
      const response = await h.request({ email: 'qa@example.test', next }, origin);
      assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), origin);
      const requested = new URL(h.requests.at(-1)[0]);
      assert.equal(requested.origin, 'https://fixture.supabase.co');
      const redirect = new URL(requested.searchParams.get('redirect_to'));
      assert.equal(redirect.origin, origin); assert.equal(redirect.pathname, '/website-password.html');
      assert.equal(redirect.searchParams.get('next'), next.startsWith(origin + '/') ? next : null);
    }
  }
  assert.ok(rpcCalls.some(([, args]) => args.p_max === 2 && args.p_window_seconds === 86400));
  assert.ok(rpcCalls.some(([, args]) => args.p_max === 10 && args.p_window_seconds === 3600));
});

test('recovery does not send mail when either existing rate limiter refuses the request', async () => {
  for (const stoppedAt of [1, 2]) {
    let calls = 0;
    const h = await runtime('website-password-recovery', { admin: { rpc: async () => ({ data: ++calls !== stoppedAt, error: null }) }, env: { WEBSITE_AUTH_REDIRECT_ORIGIN: cloud } });
    const response = await h.request({ email: 'qa@example.test' });
    assert.equal(response.status, 429); assert.equal(h.requests.length, 0);
  }
});

test('runtime dependencies retain every original helper byte and JWT setting', async () => {
  for (const slug of ['website-order-api', 'website-customer-access', 'website-password-recovery', 'website-api', 'website-preview']) {
    const before = JSON.parse(await readFile(new URL(`../runtime-baseline/${slug}.json`, import.meta.url), 'utf8'));
    for (const file of before.files.filter(f => f.name !== 'index.ts')) {
      assert.equal(await readFile(new URL(`../runtime/${slug}/${file.name}`, import.meta.url), 'utf8'), file.content);
    }
    assert.equal(await readFile(new URL(`../runtime/${slug}/_shared/sales-origin.ts`, import.meta.url), 'utf8'), await readFile(new URL('../../supabase/functions/_shared/sales-origin.ts', import.meta.url), 'utf8'));
  }
});

test('receipt-only orders cannot enter quotation, URL reservation, payment or intake through legacy and origin-less requests',async()=>{
  const admin=rowsFixture({website_admins:[{user_id:'synthetic-admin'}]});
  const h=await runtime('website-customer-access',{admin,user:{id:'synthetic-admin'}});
  for(const origin of [legacy,'https://sho-support.github.io',''])for(const action of ['admin_send_final_quote','admin_activate_order','admin_resend_intake','admin_resolve_free_url']){
    const r=await h.request({action,order_code:' 9000001001 '},origin);
    assert.equal(r.status,409);assert.equal((await r.json()).code,'line_receipt_test_only');
  }
  assert.equal(h.messages.length,0);assert.equal(h.requests.length,0);
});

test('receipt-only guards still authenticate administrators before returning the reserved-order response',async()=>{
  for(const [user,status]of [[null,401],[{id:'synthetic-stranger'},403]]){
    const h=await runtime('website-customer-access',{admin:rowsFixture({}),user});
    assert.equal((await h.request({action:'admin_activate_order',order_code:'9000001001'},legacy)).status,status);
    assert.equal(h.messages.length,0);assert.equal(h.requests.length,0);
  }
});

function receiptDatabase({code='9000001001',allow=true,linked=false,status=linked?'pending_payment':'pending_line',cancelDuringLink=false}={}){
  const token='a'.repeat(40),order={id:'synthetic-order-id',order_code:code,status,plan:'one',amount_from:15000,line_user_id:linked?'U_OTHER':null,line_link_token_hash:hash(token)};
  const reads=[],writes=[];
  return {token,order,reads,writes,from(table){
    let filters=[],values=null;
    const result=()=>{
      reads.push({table,filters});
      if(table==='website_orders')return{data:{...order},error:null};
      if(table==='website_settings'){
        const key=filters.find(([k])=>k==='key')?.[1];
        if(key==='bank_transfer_test')return{data:{value:{order_codes:allow?['9000001001']:[],message:'テスト銀行・普通0000000（架空）'}},error:null};
        if(key==='bank_transfer')return{data:{value:{message:'SYNTHETIC_REAL_BANK_MUST_NOT_ENTER_TEST_REPLY'}},error:null};
      }
      throw Error('Unexpected fixture query');
    };
    const persist=()=>{
      if(!values)throw Error('Unexpected fixture mutation');
      if(cancelDuringLink)order.status='cancelled';
      if(!filters.every(([k,v])=>order[k]===v))return {data:null,error:null};
      writes.push({table,values});Object.assign(order,values);
      return {data:{id:order.id},error:null};
    };
    const chain={select(){return chain;},eq(k,v){filters.push([k,v]);return chain;},maybeSingle:async()=>values?persist():result(),update(v){values=v;return chain;},then(resolve,reject){return Promise.resolve(persist()).then(resolve,reject);}};
    return chain;
  }};
}
async function lineReceipt({db=receiptDatabase(),signature=true,token=db.token,canonical=false}={}){
  const replies=[],secret='synthetic-HMAC-secret-only';
  const h=await runtime('website-line-webhook',{admin:db,canonical,env:{LINE_CHANNEL_SECRET:secret},fetcher:async(url,options)=>{
    if(url==='https://api.line.me/v2/bot/profile/U_FIXTURE')return Response.json({displayName:'Synthetic LINE sender'});
    if(url==='https://api.line.me/v2/bot/message/reply'){replies.push(JSON.parse(options.body));return Response.json({});}
    throw Error('Unexpected provider operation');
  }});
  const raw=JSON.stringify({events:[{type:'message',message:{type:'text',text:'注文ID: '+db.order.order_code+'\n連携コード: '+token},source:{userId:'U_FIXTURE'},replyToken:'synthetic-reply-token'}]});
  const r=await h.handler(new Request('https://fixture.supabase.co/functions/v1/website-line-webhook',{method:'POST',headers:{'x-line-signature':signature?createHmac('sha256',secret).update(raw).digest('base64'):'not-a-valid-signature'},body:raw}));
  return {r,db,replies,h,text:replies.flatMap(x=>x.messages.map(m=>m.text)).join('\n')};
}
test('the exact signed LINE handler accepts the numeric fixture and always labels it as a non-commercial test',async()=>{
  const {r,db,replies,text}=await lineReceipt();assert.equal(r.status,200);assert.equal(replies.length,1);
  assert.match(text,/9000001001/);assert.match(text,/接続テスト専用/);assert.match(text,/テスト用・架空口座/);assert.match(text,/実際に振り込まない/);
  assert.ok(!text.includes('SYNTHETIC_REAL_BANK'));assert.ok(!db.reads.some(x=>x.filters.some(([k,v])=>k==='key'&&v==='bank_transfer')));
  assert.equal(db.writes.length,1);assert.equal(db.order.status,'pending_payment');assert.equal(db.order.line_user_id,'U_FIXTURE');
});
test('missing fixture allowlist stays explicitly test-only even when a production bank is configured',async()=>{
  const {r,text}=await lineReceipt({db:receiptDatabase({allow:false})});assert.equal(r.status,200);
  assert.match(text,/接続テスト専用/);assert.match(text,/未設定/);assert.ok(!text.includes('0000000'));assert.ok(!text.includes('正式なお見積り'));
});
test('ordinary numeric orders preserve the existing non-test receipt flow',async()=>{
  const {r,text,db}=await lineReceipt({db:receiptDatabase({code:'1001'})});assert.equal(r.status,200);
  assert.match(text,/正式なお見積り/);assert.ok(!text.includes('接続テスト専用'));assert.ok(!text.includes('0000000'));assert.equal(db.writes.length,1);
});
test('the release webhook preserves ordinary and test receipts and never restores a cancelled order',async()=>{
  for(const code of ['1001','9000001001']){
    const receipt=await lineReceipt({db:receiptDatabase({code}),canonical:true});
    assert.equal(receipt.r.status,200);assert.equal(receipt.replies.length,1);assert.equal(receipt.db.order.status,'pending_payment');
    assert.equal(receipt.text.includes('0000000'),code==='9000001001');
  }
  for(const state of [{status:'cancelled'},{cancelDuringLink:true}]){
    const receipt=await lineReceipt({db:receiptDatabase({code:'1001',...state}),canonical:true});
    assert.equal(receipt.r.status,200);assert.equal(receipt.replies.length,0);assert.equal(receipt.db.writes.length,0);
    assert.equal(receipt.db.order.status,'cancelled');assert.equal(receipt.db.order.line_user_id,null);
  }
});
test('unsigned LINE requests cannot read orders or write pairing state',async()=>{
  const {r,db,h,replies}=await lineReceipt({signature:false});assert.equal(r.status,401);assert.equal(db.reads.length,0);assert.equal(db.writes.length,0);assert.equal(h.requests.length,0);assert.equal(replies.length,0);
});
test('the receipt fixture still requires its matching pairing code and refuses a different LINE account',async()=>{
  const wrong=await lineReceipt({token:'b'.repeat(40)});assert.equal(wrong.r.status,200);assert.equal(wrong.db.writes.length,0);assert.match(wrong.text,/連携コードを確認できません/);
  const other=await lineReceipt({db:receiptDatabase({linked:true})});assert.equal(other.r.status,200);assert.equal(other.db.writes.length,0);assert.match(other.text,/別のLINEアカウント/);
});
test('historical LINE and customer runtime deployment bytes remain available for rollback',async()=>{
  for(const [slug,version]of [['website-line-webhook',20],['website-customer-access',54]]){
    const before=JSON.parse(await readFile(new URL(`../runtime-baseline/${slug}-${version}.json`,import.meta.url),'utf8'));
    for(const file of before.files.filter(f=>f.name!=='index.ts'))assert.equal(await readFile(new URL(`../runtime/${slug}/${file.name}`,import.meta.url),'utf8'),file.content);
    assert.equal(await readFile(new URL(`../runtime/${slug}/_shared/line-receipt-test.mjs`,import.meta.url),'utf8'),await readFile(new URL('../../supabase/functions/_shared/line-receipt-test.mjs',import.meta.url),'utf8'));
  }
  assert.equal(hash(await readFile(new URL('../runtime/website-line-webhook/index.ts',import.meta.url),'utf8')),
    'c1fb652da74bf5ce9467a1a076851b7b7d2923a90edf5cced3f462b18e24e066');
});
