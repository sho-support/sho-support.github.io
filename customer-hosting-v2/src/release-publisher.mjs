// Server-only publishing. The public reader must never expose these methods.
import {prepareRelease, validateAssetPath} from './release-preflight.mjs';

const SITE_ID = /^[0-9]{4,10}$/;
const RELEASE_ID = /^[a-f0-9]{12,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const pointerKey = id => `sites/${id}/active.json`;
const manifestKey = (id, release) => `sites/${id}/release-manifests/${release}.json`;
const assetKey = (id, release, path) => `sites/${id}/releases/${release}/${path}`;

function requireStore(bucket) {
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.head !== 'function' || typeof bucket.put !== 'function') {
    throw new Error('R2 binding with get/head/put is required');
  }
}

function verifyIds(siteId, releaseId) {
  const id = String(siteId ?? ''), release = String(releaseId ?? '');
  if (!SITE_ID.test(id) || !RELEASE_ID.test(release)) throw new Error('Invalid site ID or release ID');
  return {id, release};
}

async function sha256(body) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function stageRelease({bucket, siteId, releaseId, files}) {
  requireStore(bucket);
  const plan = prepareRelease(siteId, releaseId, files);
  const completedKey = manifestKey(plan.site_id, plan.release);
  if (await bucket.head(completedKey)) throw new Error('Release manifest already exists');
  const entries = [];
  for (const asset of plan.objects) {
    // A partial attempt needs a fresh ID. Neither partial nor completed files are overwritten.
    if (await bucket.head(asset.key)) throw new Error(`Release key already exists: ${asset.path}`);
    const checksum = await sha256(asset.body);
    const written = await bucket.put(asset.key, asset.body, {
      onlyIf: new Headers({'If-None-Match': '*'}),
      sha256: checksum,
      customMetadata: {sha256: checksum}
    });
    if (!written) throw new Error(`Immutable release write rejected: ${asset.path}`);
    const verified = await bucket.head(asset.key);
    if (!verified || Number(verified.size) !== asset.bytes || verified.customMetadata?.sha256 !== checksum) {
      throw new Error(`R2 asset verification failed: ${asset.path}`);
    }
    entries.push({path: asset.path, bytes: asset.bytes, sha256: checksum});
  }
  const manifest = JSON.stringify({
    version: 1, site_id: plan.site_id, release: plan.release,
    total_bytes: plan.total_bytes, files: entries
  });
  const completed = await bucket.put(completedKey, manifest, {
    onlyIf: new Headers({'If-None-Match': '*'}),
    httpMetadata: {contentType: 'application/json'},
    sha256: await sha256(manifest)
  });
  if (!completed) throw new Error('Release completion write rejected');
  await verifyStagedRelease({bucket, siteId: plan.site_id, releaseId: plan.release});
  return {site_id: plan.site_id, release: plan.release, total_bytes: plan.total_bytes, file_count: plan.file_count, staged: true};
}

export async function verifyStagedRelease({bucket, siteId, releaseId}) {
  requireStore(bucket);
  const {id, release} = verifyIds(siteId, releaseId);
  const object = await bucket.get(manifestKey(id, release));
  if (!object || !Number.isSafeInteger(object.size) || object.size > MAX_MANIFEST_BYTES) {
    throw new Error('Target release has no valid completion manifest');
  }
  let manifest;
  try { manifest = JSON.parse(await object.text()); }
  catch { throw new Error('Unreadable release completion manifest'); }
  if (manifest?.version !== 1 || manifest.site_id !== id || manifest.release !== release
      || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 500) {
    throw new Error('Release completion manifest does not match target');
  }
  const names = new Set();
  let total = 0;
  for (const entry of manifest.files) {
    validateAssetPath(entry.path);
    if (names.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0
        || entry.bytes > 15 * 1024 * 1024 || !SHA256.test(entry.sha256)) {
      throw new Error('Invalid asset in release completion manifest');
    }
    names.add(entry.path);
    total += entry.bytes;
    if (total > 35 * 1024 * 1024) throw new Error('Release size exceeds guardrail');
    const stored = await bucket.head(assetKey(id, release, entry.path));
    if (!stored || stored.size !== entry.bytes || stored.customMetadata?.sha256 !== entry.sha256) {
      throw new Error(`Staged asset is missing or changed: ${entry.path}`);
    }
  }
  if (!names.has('index.html') || total !== manifest.total_bytes) throw new Error('Incomplete release manifest');
  return manifest;
}

export async function activateRelease({bucket, siteId, releaseId, expectedCurrentRelease, authorize}) {
  requireStore(bucket);
  const {id, release} = verifyIds(siteId, releaseId);
  if (expectedCurrentRelease !== null && !RELEASE_ID.test(String(expectedCurrentRelease || ''))) {
    throw new Error('An explicit expected current release (or null) is required');
  }
  if (typeof authorize !== 'function' || await authorize({siteId: id, releaseId: release}) !== true) {
    throw new Error('Publication was not authorized');
  }
  await verifyStagedRelease({bucket, siteId: id, releaseId: release});
  const key = pointerKey(id), current = await bucket.get(key);
  let condition;
  if (current === null) {
    if (expectedCurrentRelease !== null) throw new Error('Current release unexpectedly missing');
    condition = new Headers({'If-None-Match': '*'});
  } else {
    if (typeof current.text !== 'function' || !current.httpEtag || Number(current.size) > 4096) {
      throw new Error('Invalid current release object');
    }
    let state;
    try { state = JSON.parse(await current.text()); } catch { throw new Error('Unreadable current release'); }
    if (state?.status !== 'live' || state.release !== expectedCurrentRelease) {
      throw new Error('Current release changed; refusing to overwrite');
    }
    condition = new Headers({'If-Match': current.httpEtag});
  }
  const live = JSON.stringify({status: 'live', release});
  const committed = await bucket.put(key, live, {onlyIf: condition, httpMetadata: {contentType: 'application/json'}});
  if (!committed) throw new Error('Concurrent publication conflict: active release unchanged');
  return {site_id: id, release, previous_release: expectedCurrentRelease, committed: true};
}

// Server-only export. Callers must check customer/admin access before downloading.
export async function exportStagedRelease({bucket, siteId, releaseId}) {
  const manifest = await verifyStagedRelease({bucket, siteId, releaseId});
  const files = [];
  for (const entry of manifest.files) {
    const object = await bucket.get(assetKey(manifest.site_id, manifest.release, entry.path));
    if (!object) throw new Error(`Backup asset is missing: ${entry.path}`);
    const content = new Uint8Array(await object.arrayBuffer());
    if (content.byteLength !== entry.bytes || await sha256(content) !== entry.sha256) {
      throw new Error(`Backup checksum verification failed: ${entry.path}`);
    }
    files.push({path: entry.path, content});
  }
  return {site_id: manifest.site_id, release: manifest.release, files};
}
