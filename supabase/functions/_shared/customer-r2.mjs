// Server-only R2 S3 transport for Supabase. No public/upload URL or bucket-wide API.
// The caller still owns admin authorization, persisted approval and publication locks.
const ID = /^[0-9]{4,10}$/;
const RELEASE = /^[a-f0-9]{12,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ETAG = /^"[A-Za-z0-9-]{1,128}"$/;
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const digest = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

function storageError(code, status, write = false) {
  // Provider bodies/URLs/headers and signer errors may contain secrets. Do not echo them.
  const error = new Error(write
    ? 'R2 write outcome unknown; reconcile stored state before retrying'
    : 'R2 storage request failed');
  error.code = code;
  if (status) error.status = status;
  error.outcomeUnknown = write;
  return error;
}

function keyLimit(key, siteId) {
  const prefix = `sites/${siteId}/`;
  if (typeof key !== 'string' || !key.startsWith(prefix)) throw new Error('R2 key is outside the assigned site');
  const rest = key.slice(prefix.length);
  if (rest === 'active.json') return 4096;
  const manifest = /^release-manifests\/([a-f0-9]+)\.json$/.exec(rest);
  if (manifest && RELEASE.test(manifest[1])) return 256 * 1024;
  const asset = /^releases\/([a-f0-9]+)\/(.+)$/.exec(rest);
  const path = asset?.[2];
  if (!asset || !RELEASE.test(asset[1]) || path.length > 300 || !/^[A-Za-z0-9._/-]+$/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('Unsafe R2 object key');
  }
  return 15 * 1024 * 1024;
}

function objectInfo(response, limit) {
  const rawSize = response.headers.get('content-length');
  const size = rawSize !== null && /^(0|[1-9][0-9]*)$/.test(rawSize) ? Number(rawSize) : NaN;
  const httpEtag = response.headers.get('etag');
  if (!Number.isSafeInteger(size) || size > limit || !ETAG.test(httpEtag || '')) {
    throw storageError('R2_INVALID_RESPONSE');
  }
  const customMetadata = {};
  for (const [name, value] of response.headers) {
    if (name.startsWith('x-amz-meta-')) customMetadata[name.slice(11)] = value;
  }
  return {size, httpEtag, customMetadata};
}

async function readObject(response, info, limit) {
  const parts = [];
  let length = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit || length > info.size) throw storageError('R2_INVALID_RESPONSE');
        parts.push(value);
      }
    } catch {
      await reader.cancel().catch(() => {});
      throw storageError('R2_INVALID_RESPONSE');
    } finally { reader.releaseLock(); }
  }
  if (length !== info.size) throw storageError('R2_INVALID_RESPONSE');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const checksum = info.customMetadata.sha256;
  if (checksum !== undefined && (!SHA256.test(checksum) || await digest(bytes) !== checksum)) {
    throw storageError('R2_CHECKSUM_MISMATCH');
  }
  return {...info, body: new Response(bytes).body,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer};
}

export function createR2S3Store({accountId, bucketName, siteId, sign, fetch: transport = globalThis.fetch, timeoutMs = 20000}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName || '')
      || !ID.test(String(siteId || '')) || typeof sign !== 'function' || typeof transport !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('Invalid server-side R2 configuration');
  }
  const id = String(siteId);
  const origin = `https://${accountId}.r2.cloudflarestorage.com`;
  const objectUrl = key => `${origin}/${bucketName}/${key.split('/').map(encodeURIComponent).join('/')}`;

  async function request(method, key, headers = new Headers(), body, consume = response => response) {
    keyLimit(key, id);
    const url = objectUrl(key), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      // sign() signs once; AwsClient.fetch() has automatic retries and is deliberately not used.
      const signed = await sign(new Request(url, {method, headers, body, redirect: 'error', signal: controller.signal}),
        {aws: {allHeaders: true}});
      if (!(signed instanceof Request) || signed.url !== url || signed.method !== method) {
        throw storageError('R2_SIGNER_REJECTED');
      }
      // Never forward signed credentials to a redirect destination.
      response = await transport(signed, {redirect: 'error', signal: controller.signal});
      if (response.status >= 300 && response.status < 400) throw storageError('R2_REDIRECT_REJECTED');
      return await consume(response);
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('R2_')) throw error;
      throw storageError(method === 'PUT' ? 'R2_WRITE_OUTCOME_UNKNOWN' : 'R2_TRANSPORT_FAILED', undefined, method === 'PUT');
    } finally {
      clearTimeout(timer);
      await response?.body?.cancel().catch(() => {});
    }
  }

  return Object.freeze({
    async head(key) {
      const limit = keyLimit(key, id), response = await request('HEAD', key);
      if (response.status === 404) return null;
      if (response.status !== 200) throw storageError('R2_HTTP_ERROR', response.status);
      return objectInfo(response, limit);
    },
    async get(key) {
      const limit = keyLimit(key, id);
      return request('GET', key, undefined, undefined, async response => {
        if (response.status === 404) { await response.body?.cancel(); return null; }
        if (response.status !== 200) { await response.body?.cancel(); throw storageError('R2_HTTP_ERROR', response.status); }
        return readObject(response, objectInfo(response, limit), limit);
      });
    },
    async put(key, value, options = {}) {
      const limit = keyLimit(key, id);
      if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new Error('Invalid R2 object content');
      const bytes = typeof value === 'string' ? encoder.encode(value) : value.slice();
      if (!bytes.byteLength || bytes.byteLength > limit) throw new Error('R2 object exceeds its size limit');
      const condition = new Headers(options.onlyIf);
      const ifNone = condition.get('if-none-match'), ifMatch = condition.get('if-match');
      if (!(ifNone === '*' && !ifMatch) && !(key.endsWith('/active.json') && ETAG.test(ifMatch || '') && !ifNone)) {
        throw new Error('A safe conditional R2 write is required');
      }
      const checksum = await digest(bytes);
      if ((options.sha256 !== undefined && options.sha256 !== checksum)
          || (options.customMetadata?.sha256 !== undefined && options.customMetadata.sha256 !== checksum)) {
        throw new Error('R2 content checksum does not match');
      }
      const metadata = {...options.customMetadata, sha256: checksum};
      const headers = new Headers({
        'x-amz-content-sha256': checksum,
        'content-type': options.httpMetadata?.contentType || 'application/octet-stream'
      });
      if (ifNone) headers.set('if-none-match', ifNone);
      if (ifMatch) headers.set('if-match', ifMatch);
      for (const [name, value] of Object.entries(metadata)) {
        if (!/^[a-z0-9-]{1,40}$/.test(name) || typeof value !== 'string' || value.length > 512 || /[^\x20-\x7e]/.test(value)) {
          throw new Error('Invalid R2 object metadata');
        }
        headers.set(`x-amz-meta-${name}`, value);
      }
      const response = await request('PUT', key, headers, bytes);
      if (response.status === 412) return null;
      if (response.status !== 200) throw storageError('R2_HTTP_ERROR', response.status, response.status >= 500);
      const httpEtag = response.headers.get('etag');
      if (!ETAG.test(httpEtag || '')) throw storageError('R2_WRITE_OUTCOME_UNKNOWN', undefined, true);
      return {size: bytes.byteLength, httpEtag, customMetadata: metadata};
    }
  });
}
