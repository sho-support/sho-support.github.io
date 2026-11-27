import {customerR2Store} from './customer-r2.ts';
import {cloudflareHostingEnabled} from './hosting-mode.ts';
import {createHostingPublisher,supabaseHostingDatabase} from './hosting-publication.mjs';
import {stageRelease,verifyStagedRelease} from './hosting-release-publisher.mjs';
import {snapshotCustomerSource} from './hosting-github.mjs';
import {validateAssetPath} from './hosting-release-preflight.mjs';

export const hostingHash=async(value:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value))),b=>b.toString(16).padStart(2,'0')).join('');
export async function hostingRpc(admin:any,name:string,args:any){
  const {data,error}=await admin.rpc('website_hosting_'+name,args);if(error)throw error;return data;
}
export async function hostingMapping(admin:any,siteId:string){
  if(!cloudflareHostingEnabled())throw new Error('Cloudflare hosting is not enabled');
  const h=await supabaseHostingDatabase(admin).hosting(siteId);
  if(!h)throw new Error('Customer hosting mapping is missing; migration must be reviewed');
  return h;
}
export async function reserveHostingUrl(admin:any,actorId:string,orderCode:string){
  if(!cloudflareHostingEnabled())throw new Error('Cloudflare hosting is not enabled');
  const domain=Deno.env.get('CUSTOMER_BASE_DOMAIN')||'';
  if(!domain||Deno.env.get('CUSTOMER_HOSTING_DOMAIN_READY')!==domain)throw new Error('正式公開用ドメインの所有・DNS・HTTPS確認が完了していません。');
  const r=await hostingRpc(admin,'reserve_url',{p_actor:actorId,p_order:orderCode,p_domain:domain});
  return r.public_url as string;
}
export const hostingPublisher=(admin:any)=>createHostingPublisher({db:supabaseHostingDatabase(admin),storeForSite:customerR2Store});
export async function hostingAdminState(admin:any,siteId:string){
  if(!cloudflareHostingEnabled())return null;
  const h=await supabaseHostingDatabase(admin).hosting(siteId);
  if(!h)return null;
  const {data:releases,error}=await admin.from('website_hosting_releases').select('release_id,published_at,source_commit')
    .eq('site_id',siteId).not('published_at','is',null).order('published_at',{ascending:false}).limit(10);
  if(error)throw error;
  return {provider:'cloudflare-r2',status:h.status,public_url:h.public_url,active_release:h.active_release,
    active_publication_id:h.active_publication_id,active_operation_id:h.active_operation_id,releases:releases||[]};
}

export async function beginHostingSourceBranch(admin:any,site:any){
  const h=await hostingMapping(admin,site.site_id);
  if(!h.active_release)throw new Error('No active source release is available for this update');
  const r=await supabaseHostingDatabase(admin).release(site.site_id,h.active_release);
  if(!r||!/^[a-f0-9]{40}$/.test(r.source_commit))throw new Error('Active source commit is missing');
  const owner=Deno.env.get('GITHUB_OWNER')||'sho-support';
  if(site.repo_full_name!==owner+'/site-'+site.site_id.toLowerCase())throw new Error('Untrusted customer source repository');
  const token=Deno.env.get('GITHUB_PAGES_TOKEN')||'';if(!token)throw new Error('Source backup credentials are missing');
  const branch='sho-review-'+crypto.randomUUID();
  const response=await fetch('https://api.github.com/repos/'+site.repo_full_name+'/git/refs',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10'},
    body:JSON.stringify({ref:'refs/heads/'+branch,sha:r.source_commit})
  });
  if(response.status!==201)throw new Error('Could not create the isolated update source branch');
  return branch;
}

export async function freezeHostingRelease(admin:any,site:any,job:any,branch:string,verifySource:(repo:string,commit:string,theme:string)=>Promise<any>,theme=''){
  const h=await hostingMapping(admin,site.site_id);
  if(h.active_operation_id)throw new Error('Publication recovery is required before staging');
  // Validate R2 credentials/configuration BEFORE downloading files or spending on AI in callers.
  const bucket=customerR2Store(h.public_site_id);
  const snapshot=await snapshotCustomerSource({siteId:site.site_id,repo:site.repo_full_name,branch,
    token:Deno.env.get('GITHUB_PAGES_TOKEN')||'',owner:Deno.env.get('GITHUB_OWNER')||'sho-support'});
  const quality=await verifySource(site.repo_full_name,snapshot.source_commit,theme);
  const releaseId=crypto.randomUUID().replace(/-/g,'');
  await stageRelease({bucket,siteId:h.public_site_id,releaseId,files:snapshot.files});
  const object=await bucket.get(`sites/${h.public_site_id}/release-manifests/${releaseId}.json`);
  if(!object)throw new Error('Release completion manifest is missing after staging');
  const manifestHash=await hostingHash(await object.text());
  await hostingRpc(admin,'register_release',{p_site:site.site_id,p_job:job.id,p_release:releaseId,
    p_commit:snapshot.source_commit,p_manifest:manifestHash,p_quality:{ok:true,source_check:quality,static_policy:'static-site-first-sale-v1'}});
  return {release_id:releaseId,source_commit:snapshot.source_commit,manifest_sha256:manifestHash};
}

// Token authority is checked by website-preview BEFORE this function is called.
// The path is read only from the frozen pending release, never the mutable GitHub branch.
export async function frozenPreviewFile(admin:any,siteId:string,path:string,qa=false){
  validateAssetPath(path);
  const h=await hostingMapping(admin,siteId);
  if(!h.pending_release)throw new Error('No verified private release is ready');
  const db=supabaseHostingDatabase(admin),release=await db.release(siteId,h.pending_release);
  if(!release)throw new Error('Frozen preview release metadata is missing');
  const bucket=customerR2Store(h.public_site_id),key=`sites/${h.public_site_id}/release-manifests/${h.pending_release}.json`;
  const marker=await bucket.get(key);
  if(!marker||marker.size>256*1024)throw new Error('Frozen preview completion manifest is unavailable');
  const text=await marker.text();if(await hostingHash(text)!==release.manifest_sha256)throw new Error('Frozen preview manifest changed');
  const manifest=JSON.parse(text);
  if(manifest.site_id!==h.public_site_id||manifest.release!==h.pending_release)throw new Error('Frozen preview belongs to another site');
  if(qa){
    await verifyStagedRelease({bucket,siteId:h.public_site_id,releaseId:h.pending_release});
    return {ok:true,css:true,files:manifest.files.map((f:any)=>f.path),release_id:h.pending_release};
  }
  const file=manifest.files.find((f:any)=>f.path===path);if(!file||file.bytes>7_000_000)throw new Error('Frozen preview file not found');
  const object=await bucket.get(`sites/${h.public_site_id}/releases/${h.pending_release}/${path}`);
  if(!object||object.size!==file.bytes)throw new Error('Frozen preview file is incomplete');
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.length!==file.bytes||await hostingHash(bytes)!==file.sha256)throw new Error('Frozen preview file checksum mismatch');
  return bytes;
}
