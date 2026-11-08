// Server-only R2 publishing primitives. DO NOT expose these methods through the public customer-site Worker.
// The caller MUST authorize the authenticated owner and persist the customer's approval in Supabase.
// Staging never modifies the public release pointer. Activation is a compare-and-swap operation.
import { prepareRelease } from './release-preflight.mjs';

const SITE_ID = /^[0-9]{4,10}$/;
const RELEASE_ID = /^[a-f0-9]{12,64}$/;
const pointerKey = id => `sites/${id}/active.json`;
const homeKey = (id, release) => `sites/${id}/releases/${release}/index.html`;
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

export async function stageRelease({bucket, siteId, releaseId, files}) {
  requireStore(bucket);
  const plan = prepareRelease(siteId, releaseId, files);
  for (const asset of plan.objects) {
    // Never overwrite an already staged release. A partially failed attempt must use a fresh release ID.
    if (await bucket.head(asset.key)) throw new Error(`Release key already exists: ${asset.path}`);
    const written = await bucket.put(asset.key, asset.body, {
      onlyIf: new Headers({'If-None-Match': '*'})
    });
    if (!written) throw new Error(`Immutable release write rejected: ${asset.path}`);
    const verified = await bucket.head(asset.key);
    if (!verified || Number(verified.size) !== asset.bytes) {
      throw new Error(`R2 asset verification failed: ${asset.path}`);
    }
  }
  return {site_id:plan.site_id, release:plan.release, total_bytes:plan.total_bytes, file_count:plan.file_count, staged:true};
}

export async function activateRelease({bucket, siteId, releaseId, expectedCurrentRelease, authorize}) {
  requireStore(bucket);
  const {id,release} = verifyIds(siteId,releaseId);
  // Caller must explicitly supply null for initial publication, or a release ID for an update/rollback.
  if (expectedCurrentRelease !== null && !RELEASE_ID.test(String(expectedCurrentRelease || ''))) {
    throw new Error('An explicit expected current release (or null) is required');
  }
  if (typeof authorize !== 'function' || await authorize({siteId:id,releaseId:release}) !== true) {
    throw new Error('Publication was not authorized');
  }
  if (!await bucket.head(homeKey(id,release))) throw new Error('Target release has no staged home page');
  const key = pointerKey(id), current = await bucket.get(key);
  let condition;
  if (current === null) {
    if (expectedCurrentRelease !== null) throw new Error('Current release unexpectedly missing');
    condition = new Headers({'If-None-Match':'*'});
  } else {
    if (typeof current.text !== 'function' || !current.httpEtag) throw new Error('Invalid current release object');
    let state;
    try { state=JSON.parse(await current.text()); } catch { throw new Error('Unreadable current release'); }
    if (state?.status !== 'live' || state.release !== expectedCurrentRelease) {
      throw new Error('Current release changed; refusing to overwrite');
    }
    condition = new Headers({'If-Match':current.httpEtag});
  }
  const live = JSON.stringify({status:'live',release});
  const committed = await bucket.put(key,live,{onlyIf:condition, httpMetadata:{contentType:'application/json'}});
  if (!committed) throw new Error('Concurrent publication conflict: active release unchanged');
  return {site_id:id,release,previous_release:expectedCurrentRelease,committed:true};
}
