import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getPlatformProxy} from 'wrangler';
import {loadPreviewTarget} from './src/preview-settings.mjs';
import {runPreviewLifecycle,PREVIEW_SITE} from './src/preview-lifecycle.mjs';

let proxy, step = 'validate_configuration';
try {
  const target = await loadPreviewTarget();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if(!/^[a-f0-9]{32}$/.test(accountId || '') || !process.env.CLOUDFLARE_API_TOKEN?.trim()) throw new Error('PREVIEW_SECRETS_MISSING');
  const folder = new URL('./.wrangler/live-preview/',import.meta.url);
  await mkdir(folder,{recursive:true});
  const config = new URL('wrangler.json',folder);
  await writeFile(config,JSON.stringify({
    name:target.worker_name,account_id:accountId,compatibility_date:'2026-11-07',
    main:fileURLToPath(new URL('./preview-worker.mjs',import.meta.url)),
    vars:{TEST_WORKER_HOST:target.worker_host},
    r2_buckets:[{binding:'SITES',bucket_name:target.bucket_name,preview_bucket_name:target.bucket_name,remote:true}]
  }),{mode:0o600});
  step = 'connect_official_remote_r2_binding';
  proxy = await getPlatformProxy({configPath:fileURLToPath(config),envFiles:[],persist:false,remoteBindings:true});
  step = 'check_reserved_fixture_storage_budget';
  const existing = await proxy.env.SITES.list({prefix:`sites/${PREVIEW_SITE}/`,limit:81});
  if(existing.truncated || existing.objects.length > 64) throw new Error('PREVIEW_RETAINED_TEST_FILES_LIMIT');
  const origin = 'https://' + target.worker_host;
  const read = async(path,options={})=>fetch(origin+path,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  step = 'check_worker_https_health';
  let healthy = false;
  for(let attempt=0;attempt<6;attempt++) {
    const response = await read('/healthz');
    console.log(JSON.stringify({health_probe:attempt+1,status:response.status,
      verified_preview_marker:response.headers.get('x-sho-environment')==='customer-hosting-preview'}));
    if(response.status===200 && await response.text()==='ok'
      && response.headers.get('x-sho-environment')==='customer-hosting-preview') {healthy=true;break;}
    if([401,403,429].includes(response.status))throw new Error('PREVIEW_HTTP_ACCESS_DENIED');
    if(attempt<5)await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!healthy)throw new Error('PREVIEW_HEALTH_NOT_READY');
  step = 'reserved_fixture_lifecycle';
  const proof = await runPreviewLifecycle({bucket:proxy.env.SITES,read,
    onPhase:name=>{step=name;console.log('Checking: '+name);},onStep:name=>console.log('Verified: '+name)});
  await mkdir(new URL('./.wrangler/proof/',import.meta.url),{recursive:true});
  await writeFile(new URL('./.wrangler/proof/live-preview.json',import.meta.url),JSON.stringify({
    ...proof,url:origin,verified_at:new Date().toISOString(),source_commit:process.env.GITHUB_SHA || null
  },null,2)+'\n');
  console.log(JSON.stringify(proof,null,2));
} catch(error) {
  // Do not print remote proxy diagnostics, account identifiers or credentials.
  const ownCode=String(error.message || '').split('\n')[0];
  console.error(JSON.stringify({status:'failed',step,code:/^PREVIEW_[A-Z_]+$/.test(ownCode)?ownCode:'LIVE_PREVIEW_CHECK_FAILED'}));
  process.exitCode=1;
} finally {await proxy?.dispose();}
