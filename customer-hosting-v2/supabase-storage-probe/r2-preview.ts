import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {AwsClient} from 'npm:aws4fetch@1.0.20';
import {allowedProbeClaims} from './policy.mjs';
import {readinessSummary} from './configuration.mjs';
import {createR2S3Store} from '../../supabase/functions/_shared/customer-r2.mjs';
import {runPreviewLifecycle,PREVIEW_SITE} from '../src/preview-lifecycle.mjs';

// Fail closed in git. The deployment is restricted to one inspected CI identity and deadline.
// Only the pre-existing fictional fixture is touched. No database, Auth, LINE, AI or customer data.
const ALLOWED_RUN_ID='__ALLOWED_RUN_ID__',ALLOWED_SHA='__ALLOWED_SHA__';
const ALLOWED_UNTIL=Number('__ALLOWED_UNTIL__');
const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),{timeoutDuration:8000});
const safeResponse=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return safeResponse({error:'Method not allowed'},405);
 if(!Number.isSafeInteger(ALLOWED_UNTIL)||Date.now()>ALLOWED_UNTIL)return safeResponse({error:'Closed'},403);
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!token||token.length>12000)return safeResponse({error:'Unauthorized'},401);
 try{
  const {payload}=await jwtVerify(token,keys,{issuer:'https://token.actions.githubusercontent.com',audience:'sho-resource-preview',algorithms:['RS256'],requiredClaims:['exp','iat','nbf'],maxTokenAge:600});
  if(!allowedProbeClaims(payload,ALLOWED_RUN_ID,ALLOWED_SHA))return safeResponse({error:'Forbidden'},403);
 }catch{return safeResponse({error:'Unauthorized'},401);}
 if(Deno.env.get('SUPABASE_URL')!=='https://tyhymvgjkoebetyypspj.supabase.co')return safeResponse({error:'Unexpected project'},503);
 const config=readinessSummary((name:string)=>Deno.env.get(name));
 const common={run_id:ALLOWED_RUN_ID,source_commit:ALLOWED_SHA,purpose:'supabase-r2-preview',...config,
  fixture_only:true,site_id:PREVIEW_SITE,production_data_accessed:false,external_customer_requests:0,
  real_notifications:0,ai_requests:0,production_functions_replaced:false};
 if(!Object.values(config.configured).every(Boolean)||!config.account_matches||!config.bucket_is_preview||config.hosting_enabled)
  return safeResponse({...common,ok:false,step:'configuration',error:'Configuration is missing, mismatched or already enabled'},503);
 let step='create_scoped_transport';
 try{
  const signer=new AwsClient({accessKeyId:Deno.env.get('CUSTOMER_R2_ACCESS_KEY_ID')!,secretAccessKey:Deno.env.get('CUSTOMER_R2_SECRET_ACCESS_KEY')!,region:'auto',service:'s3',retries:0});
  const bucket=createR2S3Store({accountId:Deno.env.get('CUSTOMER_R2_ACCOUNT_ID'),bucketName:Deno.env.get('CUSTOMER_R2_BUCKET'),siteId:PREVIEW_SITE,sign:signer.sign.bind(signer)});
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ALLOWED_RUN_ID+':'+ALLOWED_SHA)));
  const claimId=Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
  step='one_shot_run_claim';
  const claim=await bucket.put(`sites/${PREVIEW_SITE}/releases/${claimId}/probe-claim.json`,JSON.stringify({fixture_only:true,run_id:ALLOWED_RUN_ID}),{onlyIf:new Headers({'If-None-Match':'*'})});
  if(!claim)return safeResponse({...common,ok:false,step,error:'Verification already claimed'},409);
  const origin='https://sho-customer-sites-preview.zodiac-suu.workers.dev';
  const read=(path:string,options:RequestInit={})=>fetch(origin+path,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  step='verify_preview_worker';
  const health=await read('/healthz');
  if(health.status!==200||health.headers.get('x-sho-environment')!=='customer-hosting-preview'||await health.text()!=='ok')throw Error('Preview health check failed');
  const proof=await runPreviewLifecycle({bucket,read,onPhase:(name:string)=>{step=name;}});
  return safeResponse({...common,ok:true,...proof,checks:['configuration_present_and_preview_only','one_shot_run_claim','supabase_signed_r2_requests',...proof.checks],
   separate_provider_backup_verified:false,production_approval_verified:false});
 }catch(error){
  // Never return exceptions, provider bodies, URLs, headers, credential digests or lengths.
  const status=(error as {status?:unknown})?.status;
  return safeResponse({...common,ok:false,step,error:'Isolated R2 verification failed',...(Number.isInteger(status)&&Number(status)>=400&&Number(status)<=599?{provider_status:status}:{})},502);
 }
});
