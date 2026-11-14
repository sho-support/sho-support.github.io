import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadPreviewTarget} from './src/preview-settings.mjs';

const target = await loadPreviewTarget();
const config = {
  name: target.worker_name,
  main: fileURLToPath(new URL('./preview-worker.mjs', import.meta.url)),
  compatibility_date: '2026-11-07',
  workers_dev: true,
  preview_urls: false,
  routes: [],
  vars: {TEST_WORKER_HOST: target.worker_host},
  r2_buckets: [{binding: 'SITES', bucket_name: target.bucket_name}]
};
await writeFile(new URL('./wrangler.preview.local.json', import.meta.url), JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
console.log('Created verified preview configuration without production routes');
