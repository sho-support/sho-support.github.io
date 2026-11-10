import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const bucket = process.env.CF_PREVIEW_BUCKET || '';
const host = process.env.CF_PREVIEW_HOST || '';
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !bucket.includes('preview') || bucket.includes('prod')) {
  throw new Error('CF_PREVIEW_BUCKET must name a verified private preview bucket');
}
if (!/^sho-customer-sites-preview\.[a-z0-9-]+\.workers\.dev$/.test(host)) {
  throw new Error('CF_PREVIEW_HOST must be the exact test Worker hostname');
}
const config = {
  name: 'sho-customer-sites-preview',
  main: fileURLToPath(new URL('./preview-worker.mjs', import.meta.url)),
  compatibility_date: '2026-11-07',
  workers_dev: true,
  preview_urls: false,
  routes: [],
  vars: {TEST_WORKER_HOST: host},
  r2_buckets: [{binding: 'SITES', bucket_name: bucket}]
};
await writeFile(new URL('./wrangler.preview.local.json', import.meta.url), JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
console.log('Created verified preview configuration without production routes');
