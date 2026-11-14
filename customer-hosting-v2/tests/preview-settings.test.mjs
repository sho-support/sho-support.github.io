import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPreviewTarget, validatePreviewTarget} from '../src/preview-settings.mjs';

test('the confirmed non-secret target needs no additional repository variables', async () => {
  const target = await loadPreviewTarget({});
  assert.equal(target.bucket_name, 'sho-customer-sites-preview');
  assert.equal(target.site_id, '9000001000');
  assert.equal(target.verified_inventory_run, 43050040929);
  assert.ok(Object.isFrozen(target));
});

test('disabled, production and other-customer targets are rejected before deployment', async () => {
  const target = await loadPreviewTarget({});
  for (const change of [{test_deployment_enabled:false}, {site_id:'1000'}, {bucket_name:'sho-production'},
    {worker_name:'existing-sales'}, {worker_host:'sho-support.com'}, {verified_inventory_run:0}, {expected_worker_version:'unverified'}]) {
    assert.throws(() => validatePreviewTarget({...target,...change}), /INVALID_OR_DISABLED/);
  }
  assert.throws(() => validatePreviewTarget(target, {CF_PREVIEW_BUCKET:'another-preview'}), /OVERRIDE_REJECTED/);
  assert.throws(() => validatePreviewTarget(target, {CF_PREVIEW_HOST:'production.workers.dev'}), /OVERRIDE_REJECTED/);
});
