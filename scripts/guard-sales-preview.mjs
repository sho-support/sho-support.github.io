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
// First deployment only. An existing target must be reviewed before replacing it.
assert.equal(response.status, 404, `Preview target must be absent before first deploy (HTTP ${response.status})`);
console.log('Confirmed a new sales-only preview target; existing Workers and DNS will not be replaced.');
