// Node-only, non-secret deployment target. Never infer a production target.
import {readFile} from 'node:fs/promises';

export function validatePreviewTarget(target, env = {}) {
  if (target?.version !== 1 || target.test_deployment_enabled !== true
      || target.worker_name !== 'sho-customer-sites-preview'
      || target.bucket_name !== 'sho-customer-sites-preview'
      || !/^sho-customer-sites-preview\.[a-z0-9-]+\.workers\.dev$/.test(target.worker_host || '')
      || target.site_id !== '9000001000'
      || !Number.isSafeInteger(target.verified_inventory_run) || target.verified_inventory_run < 1) {
    throw new Error('INVALID_OR_DISABLED_PREVIEW_TARGET');
  }
  for (const [key, expected] of [['CF_PREVIEW_BUCKET', target.bucket_name], ['CF_PREVIEW_HOST', target.worker_host]]) {
    if (env[key]?.trim() && env[key].trim() !== expected) throw new Error('PREVIEW_TARGET_OVERRIDE_REJECTED');
  }
  return Object.freeze({...target});
}

export async function loadPreviewTarget(env = process.env) {
  return validatePreviewTarget(JSON.parse(await readFile(new URL('../preview-target.json', import.meta.url), 'utf8')), env);
}
