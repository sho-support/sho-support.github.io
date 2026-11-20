import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_R2_ACCOUNT, PRODUCTION_R2_BUCKET, prepareProductionR2 } from '../customer-hosting-v2/src/production-r2.mjs';

const name = 'sho-customer-sites';
const domain = 'sho-websites.com';
const deployedVersion = '849b6abe-0491-41a1-af2b-986bb72614fc';
const workerRoot = fileURLToPath(new URL('../customer-hosting-v2/', import.meta.url));
const source = await readFile(join(workerRoot, 'wrangler.example.jsonc'), 'utf8');
const candidate = JSON.parse(source.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n'));
const dryRun = process.argv.length === 3 && process.argv[2] === '--dry-run';
const connectDomain = process.argv.length === 3 && process.argv[2] === '--connect-domain';
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const accountPath = `/accounts/${PRODUCTION_R2_ACCOUNT}`;
const scriptPath = `${accountPath}/workers/scripts/${name}`;
const proof = { worker: name, domain, phase: 'validate' };

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

async function cloudflareRequest(path, method = 'GET', body) {
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    const envelope = await response.json().catch(() => null);
    return { http: response.status, result: response.ok && envelope?.success === true ? envelope.result : null, page: envelope?.result_info };
  } catch {
    return { http: null, result: null };
  }
}

async function readDeliveryInputs() {
  const parameters = new URLSearchParams({ name: domain, 'account.id': account });
  const [zone, objects, bucket] = await Promise.all([
    cloudflareRequest(`/zones?${parameters}`),
    cloudflareRequest(`${accountPath}/r2/buckets/${PRODUCTION_R2_BUCKET}/objects?prefix=sites%2F&per_page=1`),
    prepareProductionR2({ token, accountId: account }),
  ]);
  proof.zone_http = zone.http;
  proof.zone_verified_active = Array.isArray(zone.result) && zone.result.length === 1 && zone.result[0].name === domain && zone.result[0].account?.id === account && zone.result[0].status === 'active';
  proof.inventory_http = objects.http;
  proof.no_site_objects = Array.isArray(objects.result) ? objects.result.length === 0 && !objects.page?.cursor && objects.page?.is_truncated !== true : null;
  proof.private_r2 = bucket.ready === true;
  requireCondition(proof.private_r2, 'PRIVATE_PRODUCTION_BUCKET_NOT_VERIFIED');
  return proof.zone_verified_active ? zone.result[0] : null;
}

async function verifyDeployment(expectedVersion) {
  const [script, subdomain, deployments] = await Promise.all([
    cloudflareRequest(`${scriptPath}/settings`),
    cloudflareRequest(`${scriptPath}/subdomain`),
    cloudflareRequest(`${scriptPath}/deployments?page=1&per_page=1`),
  ]);
  proof.script_http = script.http;
  proof.workers_dev_disabled = subdomain.result?.enabled === false;
  proof.preview_disabled = subdomain.result?.previews_enabled === false;
  const bindings = script.result?.bindings;
  proof.r2_binding_verified = Array.isArray(bindings) && bindings.some(binding => binding.type === 'r2_bucket' && binding.name === 'SITES' && binding.bucket_name === PRODUCTION_R2_BUCKET);
  proof.domain_binding_verified = Array.isArray(bindings) && bindings.some(binding => binding.type === 'plain_text' && binding.name === 'CUSTOMER_BASE_DOMAIN' && binding.text === domain);
  const active = deployments.result?.deployments?.[0]?.versions;
  if (active?.length === 1 && active[0].percentage === 100 && /^[a-f0-9-]{36}$/.test(active[0].version_id ?? '')) {
    proof.version = active[0].version_id;
  }
  requireCondition(expectedVersion && proof.version === expectedVersion && proof.workers_dev_disabled && proof.preview_disabled &&
    proof.r2_binding_verified && proof.domain_binding_verified, 'DEPLOYMENT_READBACK_INCOMPLETE');
}

async function connectDedicatedZone(zone) {
  requireCondition(zone && /^[a-f0-9]{32}$/.test(zone.id), 'DEDICATED_ZONE_NOT_VERIFIED');
  requireCondition(proof.no_site_objects === true, 'PRODUCTION_SITE_PREFIX_NOT_EMPTY_OR_UNVERIFIED');
  const base = `/zones/${zone.id}`;
  const record = { type: 'AAAA', name: `*.${domain}`, content: '100::', ttl: 1, proxied: true };
  const route = { pattern: `https://*.${domain}/*`, script: name };
  const recordsPath = `${base}/dns_records`;
  const recordQuery = `${recordsPath}?${new URLSearchParams({ 'name.exact': record.name, per_page: '100' })}`;
  const routesPath = `${base}/workers/routes`;
  const sslPath = `${base}/ssl/universal/settings`;
  const redirectPath = `${base}/settings/always_use_https`;
  const [records, routes, ssl, redirect] = await Promise.all([recordQuery, routesPath, sslPath, redirectPath].map(path => cloudflareRequest(path)));
  proof.dns_read_http = records.http;
  proof.route_read_http = routes.http;
  proof.ssl_read_http = ssl.http;
  proof.redirect_read_http = redirect.http;
  proof.universal_ssl_on = ssl.result?.enabled === true;
  proof.always_https_on = redirect.result?.value === 'on';
  requireCondition(Array.isArray(records.result) && Array.isArray(routes.result), 'ZONE_DNS_OR_ROUTE_READ_ACCESS_REQUIRED');
  const dnsMatches = item => item.name === record.name && item.type === record.type && item.content === record.content && item.proxied === true && item.ttl === 1;
  const routeMatches = item => item.pattern === route.pattern && item.script === route.script;
  requireCondition(records.result.length <= 1 && records.result.every(dnsMatches), 'CONFLICTING_WILDCARD_RECORD');
  requireCondition(routes.result.length <= 1 && routes.result.every(routeMatches), 'CONFLICTING_WORKER_ROUTE');

  if (ssl.result?.enabled === false) {
    proof.ssl_write_http = (await cloudflareRequest(sslPath, 'PATCH', { enabled: true })).http;
    proof.universal_ssl_on = (await cloudflareRequest(sslPath)).result?.enabled === true;
  }
  if (redirect.result?.value === 'off') {
    proof.redirect_write_http = (await cloudflareRequest(redirectPath, 'PATCH', { value: 'on' })).http;
    proof.always_https_on = (await cloudflareRequest(redirectPath)).result?.value === 'on';
  }
  proof.dns_verified = records.result.length === 1;
  if (!proof.dns_verified) {
    proof.dns_write_http = (await cloudflareRequest(recordsPath, 'POST', record)).http;
    const after = await cloudflareRequest(recordQuery);
    proof.dns_verified = after.result?.length === 1 && after.result.every(dnsMatches);
  }
  requireCondition(proof.dns_verified, 'WILDCARD_DNS_NOT_INSTALLED');
  proof.route_verified = routes.result.length === 1;
  if (!proof.route_verified) {
    proof.route_write_http = (await cloudflareRequest(routesPath, 'POST', route)).http;
    const after = await cloudflareRequest(routesPath);
    proof.route_verified = after.result?.length === 1 && after.result.every(routeMatches);
  }
  requireCondition(proof.route_verified, 'WORKER_ROUTE_NOT_INSTALLED');
}

let work;
try {
  const [bucket] = candidate.r2_buckets;
  requireCondition(candidate.name === name && candidate.main === 'worker.mjs' && candidate.vars.CUSTOMER_BASE_DOMAIN === domain &&
    candidate.workers_dev === false && candidate.preview_urls === false && candidate.r2_buckets.length === 1 &&
    bucket.binding === 'SITES' && bucket.bucket_name === PRODUCTION_R2_BUCKET, 'WORKER_CONFIG_MISMATCH');
  requireCondition(dryRun || ((connectDomain || process.argv.length === 2) && process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_REPOSITORY === 'sho-support/sho-support.github.io' && process.env.GITHUB_REF === 'refs/heads/architecture/sales-cloudflare' &&
    account === PRODUCTION_R2_ACCOUNT && /^[A-Za-z0-9_-]{20,256}$/.test(token ?? '')), 'LIVE_DEPLOYMENT_CONTEXT_MISMATCH');
  if (connectDomain) {
    proof.phase = 'connect_domain';
    const zone = await readDeliveryInputs();
    await verifyDeployment(deployedVersion);
    await connectDedicatedZone(zone);
    proof.phase = 'domain_routed';
  } else {
    work = await mkdtemp(join(tmpdir(), 'sho-delivery-worker-'));
    const config = join(work, 'wrangler.json');
    await writeFile(config, JSON.stringify({
      name,
      main: join(workerRoot, candidate.main),
      compatibility_date: candidate.compatibility_date,
      vars: { CUSTOMER_BASE_DOMAIN: domain },
      workers_dev: false,
      preview_urls: false,
      r2_buckets: [{ binding: 'SITES', bucket_name: PRODUCTION_R2_BUCKET }],
      routes: [],
    }));
    if (!dryRun) {
      proof.phase = 'preflight';
      await readDeliveryInputs();
      const existing = await cloudflareRequest(`${scriptPath}/settings`);
      proof.predeploy_http = existing.http;
      requireCondition(existing.http === 404, 'WORKER_ALREADY_EXISTS_OR_CANNOT_BE_VERIFIED');
    }
    proof.phase = dryRun ? 'dry_run' : 'upload';
    const result = spawnSync(process.execPath, [join(workerRoot, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', config,
      ...(dryRun ? ['--dry-run', '--outdir', join(work, 'build')] : [])], {
      cwd: workerRoot, encoding: 'utf8', timeout: 110000,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    proof.wrangler_exit = result.status;
    if (result.status !== 0) {
      proof.wrangler_error_codes = [...(result.stderr ?? '').matchAll(/\[code:\s*(\d+)\]/g)].map(match => Number(match[1]));
      throw new Error('WRANGLER_OUTCOME_REQUIRES_REVIEW');
    }
    if (!dryRun) {
      proof.phase = 'verify';
      const uploadedVersion = result.stdout?.match(/Current Version ID:\s*([a-f0-9-]{36})/)?.[1];
      await verifyDeployment(uploadedVersion);
    }
    proof.phase = dryRun ? 'dry_run_passed' : 'deployed_without_route';
  }
} catch (error) {
  proof.error = /^[A-Z_]{8,100}$/.test(error?.message ?? '') ? error.message : 'UNEXPECTED_DEPLOYMENT_ERROR';
  process.exitCode = 1;
} finally {
  console.log(`SHO_DELIVERY_RESULT ${JSON.stringify(proof)}`);
  if (work) await rm(work, { recursive: true, force: true });
}
