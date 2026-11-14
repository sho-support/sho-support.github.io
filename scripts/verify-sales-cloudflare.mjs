import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const log = readFileSync(process.argv[2], 'utf8');
let deployment = null;
try { deployment = JSON.parse(log); } catch { /* Wrangler deployment output is plain text. */ }
const matches = [...log.matchAll(/https:\/\/sho-web-support-preview\.[a-z0-9-]+\.workers\.dev\b/g)];
const origins = [...new Set(matches.map(m => m[0]))];
assert.equal(origins.length, 1, 'Expected exactly one deployed sales preview URL');
const origin = origins[0];
const manifest = JSON.parse(readFileSync('test-results/sales-cloudflare/package.json', 'utf8'));
const checks = [];
async function get(path, options = {}) {
  const response = await fetch(new URL(path, origin), { ...options, signal: AbortSignal.timeout(15000) });
  assert.equal(new URL(response.url).origin, origin, `Unexpected cross-origin redirect: ${path}`);
  return response;
}
for (const file of manifest.files) {
  const response = await get('/' + file.path);
  assert.equal(response.status, 200, file.path);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Content differs: ${file.path}`);
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  const mime = response.headers.get('content-type') || '';
  assert.match(mime, file.path.endsWith('.html') ? /text\/html/ : file.path.endsWith('.css') ? /text\/css/ : /(?:text|application)\/javascript/);
  checks.push({ path: '/' + file.path, status: 200, exact_content: true, headers: true, mime: true });
}
for (const path of ['/', '/website-order', '/website-login', '/admin/', '/admin/sales-settings']) {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  checks.push({ path, status: 200, routing: true });
}
for (const path of ['/.git/config', '/.env', '/supabase/functions/website-api/index.ts', '/docs/OWNER_SETUP_RELEASE_20261114.md', '/customer-hosting-v2/package.json', '/test-results/sales-cloudflare/package.json', '/_headers', '/not-a-real-sales-page']) {
  const response = await get(path);
  assert.equal(response.status, 404, path);
  checks.push({ path, status: 404 });
}
const head = await get('/website-client.js', { method: 'HEAD' });
assert.equal(head.status, 200);
assert.equal((await head.arrayBuffer()).byteLength, 0);
checks.push({ path: '/website-client.js', method: 'HEAD', status: 200 });

// Preflight only: do not create orders, send messages, or change production APIs.
const apiBase = readFileSync('website-config.js', 'utf8').match(/SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
assert.equal(apiBase, 'https://tyhymvgjkoebetyypspj.supabase.co');
const apiChecks = [];
for (const [name, expectedError] of [['website-order-api', 'Forbidden'], ['website-customer-access', 'Forbidden'], ['website-sales-setup', 'Forbidden'], ['website-password-recovery', 'invalid_request']]) {
  const response = await fetch(`${apiBase}/functions/v1/${name}`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,apikey,x-client-info' },
    signal: AbortSignal.timeout(15000),
  });
  const allowed = response.headers.get('access-control-allow-origin');
  if (response.status === 403) {
    assert.equal((await response.json()).error, expectedError, name);
  } else {
    // An OPTIONS response may be 200 with the old origin, which the browser
    // rejects for this preview. Do not mistake HTTP 200 for CORS permission.
    assert.equal(response.status, 200, name);
    assert.notEqual(allowed, origin);
    assert.notEqual(allowed, '*');
  }
  // Also check the server's Origin guard using an unsupported, non-business
  // action. Never submit an order or invoke a valid send/publish operation.
  const denied = await fetch(`${apiBase}/functions/v1/${name}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: '__cloudflare_migration_noop__' }), signal: AbortSignal.timeout(15000),
  });
  assert.equal(denied.status, 403, `${name}: foreign-origin operation must be denied`);
  assert.equal((await denied.json()).error, expectedError, name);
  apiChecks.push({ function: name, preflight_status: response.status, response_allow_origin: allowed, noop_post_status: 403, request_accepted: false });
}
const proof = {
  checked_at: new Date().toISOString(), verification_commit: process.env.GITHUB_SHA || null,
  deployed_source_commit: deployment?.source_commit || process.env.GITHUB_SHA || null,
  deployed_version: deployment?.version || log.match(/Current Version ID:\s*([a-f0-9-]{36})/)?.[1] || null, origin,
  static_check_count: checks.length, static_checks: checks, production_api_checks: apiChecks,
  production_cutover: false, production_apis_modified: false, authentication_and_commercial_flow_complete: false,
  existing_netlify_site_modified: false, dns_modified: false, customer_messages_or_orders_created: 0,
};
writeFileSync('test-results/sales-cloudflare/live.json', JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ origin, static_checks_passed: checks.length, production_api_origins_still_blocked: apiChecks.length, production_cutover: false }));
