import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

assert.equal(process.env.GITHUB_REPOSITORY, 'sho-support/sho-support.github.io');
assert.equal(process.env.GITHUB_REF, 'refs/heads/architecture/sales-cloudflare');
const config = JSON.parse(readFileSync('sales-hosting/wrangler.preview.json', 'utf8'));
assert.equal(config.name, 'sho-web-support-preview');
assert.deepEqual(config.routes, []);
assert(!('main' in config) && !('r2_buckets' in config));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
assert(account && /^[a-f0-9]{32}$/.test(account), 'Cloudflare account is not configured');
assert(token, 'Cloudflare API token is not configured');
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${config.name}/settings`, {
  headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
});
if (response.status === 404) {
  assert(!process.env.EXPECTED_SALES_PREVIEW_VERSION, 'Expected preview Worker is missing');
  console.log('Confirmed a new sales-only preview target.');
} else {
  assert.equal(response.status, 200, `Cannot verify existing preview target (HTTP ${response.status})`);
  const known = JSON.parse(readFileSync('sales-hosting/preview-deployment.json', 'utf8'));
  assert.equal(process.env.EXPECTED_SALES_PREVIEW_VERSION, known.version, 'An explicit verified version is required to update the preview');
  const deployed = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${config.name}/deployments?per_page=1&page=1`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(deployed.status, 200, 'Cannot verify the current preview version');
  const payload = await deployed.json();
  assert.equal(payload.success, true);
  const versions = payload.result?.deployments?.[0]?.versions;
  assert(Array.isArray(versions) && versions.length === 1, 'Preview traffic split differs from the recorded deployment');
  assert.equal(versions[0].version_id, known.version, 'Preview changed since its last verified deployment');
  assert.equal(versions[0].percentage, 100, 'Preview traffic split differs from the recorded deployment');
  console.log('Confirmed the existing preview still serves the exact version recorded by this repository.');
}
