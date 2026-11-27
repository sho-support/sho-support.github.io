import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {allowedProbeClaims,PROBE_BUCKET} from './policy.mjs';
import {verifyIntakeAssets} from '../../supabase/functions/_shared/intake-assets.mjs';
// Fail closed in git. Substitute ONLY an inspected CI run/commit in the isolated deployment.
const ALLOWED_RUN_ID='__ALLOWED_RUN_ID__',ALLOWED_SHA='__ALLOWED_SHA__';
const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),{timeoutDuration:8000});
const json=(data:unknown,status=200)=>Response.json(data,{status});
const check=(ok:unknown)=>{if(!ok)throw Error('Storage probe expectation failed');};
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))),b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(!token||token.length>12000)return json({error:'Unauthorized'},401);
  try{
    const {payload}=await jwtVerify(token,keys,{issuer:'https://token.actions.githubusercontent.com',audience:'sho-resource-preview',algorithms:['RS256'],requiredClaims:['exp','iat','nbf'],maxTokenAge:600});
    if(!allowedProbeClaims(payload,ALLOWED_RUN_ID,ALLOWED_SHA))return json({error:'Forbidden'},403);
  }catch{return json({error:'Unauthorized'},401);}
  if(Deno.env.get('SUPABASE_URL')!=='https://tyhymvgjkoebetyypspj.supabase.co')return json({error:'Unexpected test project'},503);
  let step='inventory';
  try{
    const url=Deno.env.get('SUPABASE_URL')!,admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const anonymous=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false}});
    const {data:buckets,error:inventoryError}=await admin.storage.listBuckets();check(!inventoryError);
    const existing=buckets?.find(b=>b.id===PROBE_BUCKET);
    if(!existing){const {error}=await admin.storage.createBucket(PROBE_BUCKET,{public:false,fileSizeLimit:4096,allowedMimeTypes:['image/png']});check(!error);}
    const {data:bucket,error:bucketError}=await admin.storage.getBucket(PROBE_BUCKET);
    check(!bucketError&&bucket&&!bucket.public&&bucket.file_size_limit===4096&&bucket.allowed_mime_types?.length===1&&bucket.allowed_mime_types[0]==='image/png');
    // Fixed fictional PNG, never customer data. A one-shot marker prevents repeating a run.
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
    const prefix='qaguard/secure-intake/top_photos/'+ALLOWED_RUN_ID;
    const storage=admin.storage.from(PROBE_BUCKET),client=anonymous.storage.from(PROBE_BUCKET);
    step='claim';
    const {error:claimError}=await storage.upload(prefix+'-claimed.png',bytes,{contentType:'image/png',upsert:false});
    if(claimError)return json({error:'Test already claimed or unavailable'},409);
    const checks=['private_isolated_4KB_bucket','one_shot_run_claim'];
    step='signed_upload';
    const path=prefix+'-source.png',{data:ticket,error:ticketError}=await storage.createSignedUploadUrl(path,{upsert:false});check(!ticketError&&ticket?.token);
    const {error:uploadError}=await client.uploadToSignedUrl(path,ticket!.token,bytes,{contentType:'image/png',upsert:false});check(!uploadError);checks.push('anonymous_signed_upload');
    step='metadata';
    const verified=await verifyIntakeAssets('qaguard',{files:{top_photos:[{name:'fixture.png',path,size:1}]}},async(p:string)=>{const {data,error}=await storage.info(p);check(!error&&data);return data;});
    check(verified.totalBytes===bytes.length&&verified.fileCount===1);checks.push('actual_size_and_mime_via_pinned_SDK_info');
    step='path_isolation';
    const {error:foreignPathError}=await client.uploadToSignedUrl(prefix+'-wrong-path.png',ticket!.token,bytes,{contentType:'image/png'});check(foreignPathError);checks.push('signed_token_cannot_change_path');
    step='duplicate';
    const {error:duplicateError}=await client.uploadToSignedUrl(path,ticket!.token,bytes,{contentType:'image/png',upsert:false});check(duplicateError);checks.push('default_signed_upload_cannot_overwrite');
    step='private_download';
    const {data:privateData,error:privateError}=await client.download(path);check(privateError&&!privateData);checks.push('anonymous_private_download_denied');
    step='mime_rejection';
    const {data:bad,error:badTicket}=await storage.createSignedUploadUrl(prefix+'-bad.png',{upsert:false});check(!badTicket&&bad?.token);
    const {error:badMime}=await client.uploadToSignedUrl(prefix+'-bad.png',bad!.token,new Blob(['not an image'],{type:'text/html'}),{contentType:'text/html'});check(badMime);checks.push('bucket_rejects_non_image_mime');
    step='restore';
    const {data:download,error:downloadError}=await storage.download(path);check(!downloadError&&download);const exported=new Uint8Array(await download!.arrayBuffer());
    const restored=prefix+'-restored.png';const {error:restoreError}=await storage.upload(restored,exported,{contentType:'image/png',upsert:false});check(!restoreError);
    const {data:again,error:againError}=await storage.download(restored);check(!againError&&again);check(await digest(new Uint8Array(await again!.arrayBuffer()))===await digest(bytes));checks.push('download_and_restore_identical_bytes');
    return json({ok:true,run_id:ALLOWED_RUN_ID,source_commit:ALLOWED_SHA,bucket:PROBE_BUCKET,checks,fixture_bytes:bytes.length,fixture_sha256:await digest(bytes),real_orders:0,real_notifications:0,ai_requests:0,production_bucket_modified:false,production_functions_replaced:false});
  }catch{return json({error:'Isolated Storage verification failed; inspect the controlled test, not customer data',step},500);}
});
