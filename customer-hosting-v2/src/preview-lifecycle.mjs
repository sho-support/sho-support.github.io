// Shared by real remote-R2 verification and actual local workerd tests.
// This fixture is NOT a Supabase customer's approval or a production publication.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {stageRelease, activateRelease, exportStagedRelease} from './release-publisher.mjs';

export const PREVIEW_SITE = '9000001000';
export const FIXTURE_MARKER = 'SHO_RESERVED_PREVIEW_FIXTURE_V1';
const prefix = `sites/${PREVIEW_SITE}/`;
const keyPattern = /^sites\/9000001000\/(?:active\.json|release-manifests\/[a-f0-9]{12,64}\.json|releases\/[a-f0-9]{12,64}\/(?:index\.html|assets\/main\.css))$/;

export function scopedPreviewStore(raw, {maxWrites = 24, maxReads = 240, timeoutMs = 20000} = {}) {
  let writes = 0, reads = 0, uploaded = 0, uncertain = false;
  async function invoke(method, key, ...args) {
    if (!keyPattern.test(key) || !key.startsWith(prefix)) throw new Error('PREVIEW_KEY_OUTSIDE_RESERVED_FIXTURE');
    if (uncertain) throw new Error('PREVIEW_STORAGE_OUTCOME_UNKNOWN');
    if (method === 'put') {
      const value = args[0];
      const bytes = typeof value === 'string' ? Buffer.byteLength(value) : value?.byteLength;
      if (++writes > maxWrites || !Number.isSafeInteger(bytes) || bytes > 8192 || (uploaded += bytes) > 65536) {
        throw new Error('PREVIEW_WRITE_BUDGET_EXCEEDED');
      }
    } else if (++reads > maxReads) throw new Error('PREVIEW_READ_BUDGET_EXCEEDED');
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => raw[method](key, ...args)),
        new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('PREVIEW_STORAGE_DEADLINE')), timeoutMs);})
      ]);
    } catch (error) {
      // No retry or compensating write after an ambiguous provider write.
      if (method === 'put') uncertain = true;
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    get:key=>invoke('get',key), head:key=>invoke('head',key), put:(key,...args)=>invoke('put',key,...args),
    usage:()=>({writes,reads,uploaded_bytes:uploaded})
  };
}

export function previewFiles(label) {
  assert.ok(['A','B','C','D'].includes(label));
  return [{path:'index.html',content:`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="sho-test-fixture" content="${FIXTURE_MARKER}"><meta name="robots" content="noindex,nofollow">
<title>SHO WEB SUPPORT 公開基盤テスト</title><link rel="stylesheet" href="/assets/main.css"></head>
<body><main><p class="brand">SHO WEB SUPPORT</p><p class="badge">公開基盤の動作確認用</p>
<h1>小さく始めて、<br>安心して届ける。</h1><p>このページは架空の顧客サイトです。正式な販売用URLではありません。</p>
<section id="checks"><h2>表示・更新・復元を確認</h2><p>非公開のR2から、承認したリリースだけを配信しています。</p>
<p class="version" data-release-label="${label}">検証用コンテンツ ${label}</p></section>
<footer>注文・決済・顧客通知は発生しません。</footer></main></body></html>`},
  {path:'assets/main.css',content:`/* fixture-${label} */
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;color:#183339;background:#eef5f1;font:16px/1.8 system-ui,sans-serif}
main{max-width:900px;margin:auto;padding:48px clamp(20px,5vw,64px)}.brand{font-size:13px;font-weight:700;letter-spacing:.09em}
.badge{display:inline-block;background:#d9eadf;border-radius:20px;padding:4px 14px;font-size:12px}
h1{font-size:clamp(30px,7vw,64px);line-height:1.4;letter-spacing:-.025em;margin:28px 0}h2{font-size:20px}
section{background:white;border:1px solid #d4e3db;border-radius:20px;padding:24px;margin:36px 0}p{overflow-wrap:anywhere}
.version{font-weight:700;color:#246044}footer{font-size:12px;color:#4f6860}` }];
}

export async function runPreviewLifecycle({bucket:raw, read, onStep = ()=>{}}) {
  const bucket = scopedPreviewStore(raw);
  const proof = [];
  const check = name => {proof.push(name); onStep(name);};
  const baseline = await bucket.get(prefix + 'active.json');
  let previous = null;
  if (baseline) {
    assert.ok(baseline.size <= 4096, 'PREVIEW_BASELINE_INVALID');
    const state = JSON.parse(await baseline.text());
    assert.equal(state.status, 'live');
    assert.match(state.release, /^[a-f0-9]{12,64}$/);
    // Refuse to overwrite any real or unknown content even in the reserved namespace.
    const source = await bucket.get(`${prefix}releases/${state.release}/index.html`);
    assert.ok(source && source.size < 8192, 'PREVIEW_BASELINE_NOT_OWNED');
    assert.ok((await source.text()).includes(`content="${FIXTURE_MARKER}"`), 'PREVIEW_BASELINE_NOT_OWNED');
    previous = state.release;
  }
  async function stateAt(path = '/', method = 'GET') {
    const response = await read(path, {method});
    assert.ok([200,404,405].includes(response.status), `PREVIEW_HTTP_${response.status}`);
    return response;
  }
  async function visible(release, label) {
    const page = await stateAt();
    if (release === null) {assert.equal(page.status,404); return;}
    assert.equal(page.status,200);
    assert.equal(page.headers.get('x-sho-release'),release);
    assert.match(page.headers.get('x-robots-tag') || '',/noindex/);
    const html = await page.text();
    assert.ok(html.includes(FIXTURE_MARKER));
    if (label) assert.ok(html.includes(`data-release-label="${label}"`));
    const css = await stateAt('/assets/main.css');
    assert.equal(css.status,200);
    assert.equal(css.headers.get('x-sho-release'),release);
    if (label) assert.ok((await css.text()).includes(`fixture-${label}`));
  }
  await visible(previous);
  check(previous === null ? 'unpublished_returns_404' : 'existing_fictional_fixture_verified');
  const ids = Array.from({length:6},()=>randomBytes(12).toString('hex'));
  const [a,b,c,d,restore,incomplete] = ids;
  const stage = (release,files)=>stageRelease({bucket,siteId:PREVIEW_SITE,releaseId:release,files});
  const activate = (release,expected,authorize=async ({siteId,releaseId})=>siteId===PREVIEW_SITE&&ids.includes(releaseId))=>activateRelease({
    bucket,siteId:PREVIEW_SITE,releaseId:release,expectedCurrentRelease:expected,authorize
  });
  await stage(a,previewFiles('A'));
  await visible(previous);
  await assert.rejects(activate(a,previous,async()=>false),/not authorized/);
  await visible(previous);
  check('staged_and_unapproved_content_stays_private');
  await activate(a,previous);
  await visible(a,'A');
  check('approved_fixture_html_and_css_served_over_https');
  await stage(b,previewFiles('B'));
  await visible(a,'A');
  await activate(b,a);
  await visible(b,'B');
  check('complete_update_switches_html_and_css');
  await stage(c,previewFiles('C'));
  await stage(d,previewFiles('D'));
  const race = await Promise.allSettled([activate(c,b),activate(d,b)]);
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(race.filter(result=>result.status==='rejected').length,1);
  const winner = race.find(result=>result.status==='fulfilled').value.release;
  await visible(winner,winner===c?'C':'D');
  check('concurrent_publication_has_exactly_one_winner');
  await activate(a,winner);
  await visible(a,'A');
  check('rollback_restores_previous_html_and_css');
  const exported = await exportStagedRelease({bucket,siteId:PREVIEW_SITE,releaseId:a});
  await stage(restore,exported.files);
  await activate(restore,a);
  await visible(restore,'A');
  check('verified_export_bytes_restore_as_a_new_release');
  const interrupted = {
    get:bucket.get,head:bucket.head,
    put:(key,...args)=>{
      if(key===`${prefix}releases/${incomplete}/assets/main.css`)throw new Error('INJECTED_PREVIEW_UPLOAD_FAILURE');
      return bucket.put(key,...args);
    }
  };
  await assert.rejects(stageRelease({bucket:interrupted,siteId:PREVIEW_SITE,releaseId:incomplete,files:previewFiles('B')}), /INJECTED_PREVIEW_UPLOAD_FAILURE/);
  await assert.rejects(activate(incomplete,restore),/completion manifest/);
  await visible(restore,'A');
  check('interrupted_upload_cannot_replace_last_good_release');
  assert.equal((await stateAt('/','POST')).status,405);
  assert.equal((await stateAt('/sites/1000/active.json')).status,404);
  const query = await stateAt('/?site=1000&release='+incomplete);
  assert.equal(query.headers.get('x-sho-release'),restore);
  check('public_reader_rejects_writes_and_cross_customer_selection');
  return {version:1,site_id:PREVIEW_SITE,fixture_only:true,approval_source:'server_owned_test_fixture',
    production_approval_verified:false,separate_provider_backup_verified:false,
    active_release:restore,checks:proof,usage:bucket.usage()};
}
