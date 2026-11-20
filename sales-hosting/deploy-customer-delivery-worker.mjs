import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_R2_ACCOUNT, PRODUCTION_R2_BUCKET, prepareProductionR2 } from '../customer-hosting-v2/src/production-r2.mjs';

const name = 'sho-customer-sites';
const domain = 'sho-websites.com';
const workerRoot = fileURLToPath(new URL('../customer-hosting-v2/', import.meta.url));
const source = await readFile(join(workerRoot, 'wrangler.example.jsonc'), 'utf8');
const candidate = JSON.parse(source.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n'));
const dryRun = process.argv.length === 3 && process.argv[2] === '--dry-run';
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const accountPath = `/accounts/${PRODUCTION_R2_ACCOUNT}`;
const scriptPath = `${accountPath}/workers/scripts/${name}`;
const proof = { worker: name, domain, phase: 'validate' };

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

async function readCloudflare(path) {
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    const envelope = await response.json().catch(() => null);
    return { http: response.status, result: envelope?.success === true ? envelope.result : null, page: envelope?.result_info };
  } catch {
    return { http: null, result: null };
  }
}

async function readDeliveryInputs() {
  const parameters = new URLSearchParams({ name: domain, 'account.id': account });
  const [zone, objects, bucket] = await Promise.all([
    readCloudflare(`/zones?${parameters}`),
    readCloudflare(`${accountPath}/r2/buckets/${PRODUCTION_R2_BUCKET}/objects?prefix=sites%2F&per_page=1`),
    prepareProductionR2({ token, accountId: account }),
  ]);
  proof.zone_http = zone.http;
  proof.zone_verified_active = Array.isArray(zone.result) && zone.result.length === 1 && zone.result[0].name === domain && zone.result[0].account?.id === account && zone.result[0].status === 'active';
  proof.inventory_http = objects.http;
  proof.no_site_objects = Array.isArray(objects.result) ? objects.result.length === 0 && !objects.page?.cursor : null;
  proof.private_r2 = bucket.ready === true;
  requireCondition(proof.private_r2, 'PRIVATE_PRODUCTION_BUCKET_NOT_VERIFIED');
}

async function verifyDeployment(expectedVersion) {
  const [script, subdomain, deployments] = await Promise.all([
    readCloudflare(`${scriptPath}/settings`),
    readCloudflare(`${scriptPath}/subdomain`),
    readCloudflare(`${scriptPath}/deployments?page=1&per_page=1`),
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

let work;
try {
  const [bucket] = candidate.r2_buckets;
  requireCondition(candidate.name === name && candidate.main === 'worker.mjs' && candidate.vars.CUSTOMER_BASE_DOMAIN === domain &&
    candidate.workers_dev === false && candidate.preview_urls === false && candidate.r2_buckets.length === 1 &&
    bucket.binding === 'SITES' && bucket.bucket_name === PRODUCTION_R2_BUCKET, 'WORKER_CONFIG_MISMATCH');
  requireCondition(dryRun || (process.argv.length === 2 && process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_REPOSITORY === 'sho-support/sho-support.github.io' && process.env.GITHUB_REF === 'refs/heads/architecture/sales-cloudflare' &&
    account === PRODUCTION_R2_ACCOUNT && /^[A-Za-z0-9_-]{20,256}$/.test(token ?? '')), 'LIVE_DEPLOYMENT_CONTEXT_MISMATCH');
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
    const existing = await readCloudflare(`${scriptPath}/settings`);
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
    requireCondition(false, 'WRANGLER_OUTCOME_REQUIRES_REVIEW');
  }
  if (!dryRun) {
    proof.phase = 'verify';
    const uploadedVersion = result.stdout?.match(/Current Version ID:\s*([a-f0-9-]{36})/)?.[1];
    await verifyDeployment(uploadedVersion);
  }
  proof.phase = dryRun ? 'dry_run_passed' : 'deployed_without_route';
} catch (error) {
  proof.error = /^[A-Z_]{8,100}$/.test(error?.message ?? '') ? error.message : 'UNEXPECTED_DEPLOYMENT_ERROR';
  process.exitCode = 1;
} finally {
  console.log(`SHO_DELIVERY_RESULT ${JSON.stringify(proof)}`);
  if (work) await rm(work, { recursive: true, force: true });
}
