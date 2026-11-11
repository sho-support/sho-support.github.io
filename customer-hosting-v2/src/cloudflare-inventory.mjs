// Read-only Cloudflare control-plane inventory. Never uploads files or changes settings.
const ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT = /^[a-f0-9]{32}$/;
const WORKER = 'sho-customer-sites-preview';
const MAX_RESPONSE = 1024 * 1024;
const REQUEST_ERRORS = new Set(['CLOUDFLARE_INVENTORY_HTTP_ERROR','CLOUDFLARE_INVENTORY_RESPONSE_TOO_LARGE',
  'INVALID_CLOUDFLARE_INVENTORY_RESPONSE','CLOUDFLARE_INVENTORY_API_ERROR']);
const previewBucket = name => typeof name === 'string'
  && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name) && name.includes('preview') && !name.includes('prod');

function fail(code, status) {
  const error = new Error(code);
  error.code = code;
  if (status) error.status = status;
  return error;
}

export async function inspectCloudflare({token, accountId, bucketName, fetch: transport = globalThis.fetch, timeoutMs = 20000}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(token)
      || (accountId && !ACCOUNT.test(accountId)) || (bucketName && !previewBucket(bucketName))
      || typeof transport !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw fail('INVALID_INVENTORY_CONFIGURATION');
  }
  async function get(path, {allowMissing = false, r2 = false} = {}) {
    // All paths originate in this module; no destination URL is supplied by a caller/API response.
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const headers = new Headers({authorization:`Bearer ${token}`,accept:'application/json'});
      if (r2) headers.set('cf-r2-jurisdiction','default');
      response = await transport(ORIGIN + '/client/v4' + path, {
        method:'GET',headers,redirect:'error',signal:controller.signal
      });
      if (response.status === 404 && allowMissing) return null;
      if (response.status !== 200) throw fail('CLOUDFLARE_INVENTORY_HTTP_ERROR',response.status);
      const advertised = response.headers.get('content-length');
      if (advertised !== null && (!/^[0-9]+$/.test(advertised) || Number(advertised) > MAX_RESPONSE)) {
        throw fail('CLOUDFLARE_INVENTORY_RESPONSE_TOO_LARGE');
      }
      const reader = response.body?.getReader(), decoder = new TextDecoder('utf-8',{fatal:true});
      let source = '', length = 0;
      if (!reader) throw fail('INVALID_CLOUDFLARE_INVENTORY_RESPONSE');
      try {
        for (;;) {
          const {done,value} = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_RESPONSE) throw fail('CLOUDFLARE_INVENTORY_RESPONSE_TOO_LARGE');
          source += decoder.decode(value,{stream:true});
        }
        source += decoder.decode();
      } finally { reader.releaseLock(); }
      let data;
      try { data = JSON.parse(source); } catch { throw fail('INVALID_CLOUDFLARE_INVENTORY_RESPONSE'); }
      if (data?.success !== true || !Object.hasOwn(data,'result')) throw fail('CLOUDFLARE_INVENTORY_API_ERROR');
      return data;
    } catch (error) {
      // Never propagate provider errors, response bodies, headers or raw fetch diagnostics.
      if (REQUEST_ERRORS.has(error?.code)) throw fail(error.code,error.status);
      throw fail('CLOUDFLARE_INVENTORY_TRANSPORT_ERROR');
    } finally {
      clearTimeout(timer);
      await response?.body?.cancel().catch(() => {});
    }
  }

  let id = accountId;
  if (!id) {
    const accounts = await get('/accounts?per_page=50&page=1');
    if (!Array.isArray(accounts.result) || accounts.result.length !== 1
        || Number(accounts.result_info?.total_pages || 1) > 1 || !ACCOUNT.test(accounts.result[0]?.id || '')) {
      throw fail('EXPLICIT_CLOUDFLARE_ACCOUNT_ID_REQUIRED');
    }
    id = accounts.result[0].id;
  }
  const base = `/accounts/${id}`;
  const results = await Promise.allSettled([
    get(base + '/workers/scripts'), get(base + '/workers/subdomain',{allowMissing:true})
  ]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const scripts = results[0].value.result, subdomain = results[1].value?.result?.subdomain ?? null;
  if (!Array.isArray(scripts) || scripts.some(script => typeof script?.id !== 'string')
      || (subdomain !== null && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain))) {
    throw fail('INVALID_CLOUDFLARE_INVENTORY_RESPONSE');
  }
  const buckets = [], cursors = new Set();
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const response = await get(base + '/r2/buckets?per_page=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),{r2:true});
    const entries = response.result?.buckets;
    if (!Array.isArray(entries) || entries.some(bucket => typeof bucket?.name !== 'string')) {
      throw fail('INVALID_CLOUDFLARE_INVENTORY_RESPONSE');
    }
    buckets.push(...entries);
    cursor = response.result_info?.cursor || response.result?.cursor || '';
    if (!cursor) {
      if (entries.length >= 100) throw fail('INCOMPLETE_R2_BUCKET_INVENTORY');
      break;
    }
    if (typeof cursor !== 'string' || cursor.length > 2048 || cursors.has(cursor) || page === 9) {
      throw fail('INCOMPLETE_R2_BUCKET_INVENTORY');
    }
    cursors.add(cursor);
  }
  const candidates = buckets.filter(bucket => bucketName ? bucket.name === bucketName : previewBucket(bucket.name));
  if (candidates.length > 10 || new Set(buckets.map(bucket => bucket.name)).size !== buckets.length) {
    throw fail('AMBIGUOUS_R2_BUCKET_INVENTORY');
  }
  const inspected = [];
  for (const bucket of candidates) {
    const route = base + '/r2/buckets/' + encodeURIComponent(bucket.name);
    const checked = await Promise.allSettled([
      get(route,{r2:true}),get(route + '/domains/managed',{r2:true}),get(route + '/domains/custom',{r2:true})
    ]);
    for (const result of checked) if (result.status === 'rejected') throw result.reason;
    const [details,managed,custom] = checked.map(result => result.value.result);
    if (details?.name !== bucket.name || typeof managed?.enabled !== 'boolean'
        || !Array.isArray(custom?.domains) || custom.domains.some(domain => typeof domain?.enabled !== 'boolean')) {
      throw fail('INVALID_CLOUDFLARE_INVENTORY_RESPONSE');
    }
    inspected.push({
      name:bucket.name,jurisdiction:'default',storage_class:details.storage_class ?? bucket.storage_class ?? null,
      r2_dev_enabled:managed.enabled,custom_domain_count:custom.domains.length,
      enabled_custom_domain_count:custom.domains.filter(domain => domain.enabled).length,
      private_access_verified:managed.enabled === false && custom.domains.every(domain => domain.enabled === false)
    });
  }
  return {
    read_only:true,account_id:id,worker_count:scripts.length,
    preview_worker_exists:scripts.some(script => script.id === WORKER),workers_subdomain:subdomain,
    candidate_preview_host:subdomain ? `${WORKER}.${subdomain}.workers.dev` : null,
    default_jurisdiction_bucket_count:buckets.length,preview_buckets:inspected,
    configured_bucket_verified:!!bucketName && inspected.length === 1 && inspected[0].private_access_verified
      && String(inspected[0].storage_class || '').toLowerCase() === 'standard'
  };
}
