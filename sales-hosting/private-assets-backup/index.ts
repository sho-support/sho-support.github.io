import {Buffer} from 'node:buffer';
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {AwsClient} from 'npm:aws4fetch@1.0.20';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {exportStorageAssets,exportR2Assets,allowedAssetBackupClaims} from '../backup/assets-export.mjs';
import {sealPrivateDelivery,recipientFingerprint} from '../backup/private-delivery.mjs';
import {recipient} from './recipient.mjs';
// Committed code is closed. A temporary deployment pins one CI run and deadline.
const run='__ALLOWED_RUN_ID__',sha='__ALLOWED_SHA__',until=Number('__ALLOWED_UNTIL__');
const project='tyhymvgjkoebetyypspj',audience='sho-hp-private-assets-backup';
const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),{timeoutDuration:8000});
let started=false;
Deno.serve(async req=>{
 let stage='authentication';
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 if(!/^\d{8,20}$/.test(run)||!/^[a-f0-9]{40}$/.test(sha)||!Number.isSafeInteger(until)||Date.now()>until||req.headers.has('origin'))return json({error:'Closed'},403);
 if(req.method==='GET')return json({service:'website-private-assets-backup',build:sha});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const token=/^Bearer (.+)$/.exec(req.headers.get('authorization')||'')?.[1];if(!token||token.length>12000)return json({error:'Unauthorized'},401);
 try{
  const {payload:c}=await jwtVerify(token,keys,{issuer:'https://token.actions.githubusercontent.com',audience,algorithms:['RS256'],requiredClaims:['exp','iat','nbf'],maxTokenAge:600});
  if(!allowedAssetBackupClaims(c,run,sha))return json({error:'Unauthorized'},401);
  const raw=await req.text();if(raw.length>100)return json({error:'Invalid request'},400);const body=JSON.parse(raw);
  if(body?.action!=='export'||Object.keys(body).length!==1)return json({error:'Invalid request'},400);
  if(started)return json({error:'Already started'},409);started=true;
  stage='configuration';
  if(Deno.env.get('SUPABASE_URL')!==`https://${project}.supabase.co`||!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
   ||String(Deno.env.get('CUSTOMER_R2_ACCOUNT_ID')||'').trim()!=='bdb1bb4a771be8595d5564d5d78cb1d4'
   ||String(Deno.env.get('CUSTOMER_R2_BUCKET')||'').trim()!=='sho-customer-sites-production'
   ||!Deno.env.get('CUSTOMER_R2_ACCESS_KEY_ID')||!Deno.env.get('CUSTOMER_R2_SECRET_ACCESS_KEY')||Deno.env.get('WEBSITE_CUSTOMER_HOSTING')==='cloudflare-r2')return json({error:'Configuration unavailable'},503);
  const client=createClient(`https://${project}.supabase.co`,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(20000)})}});
  stage='storage-export-and-restore';
  const storage=await exportStorageAssets({storage:client.storage,run});
  const signer=new AwsClient({accessKeyId:Deno.env.get('CUSTOMER_R2_ACCESS_KEY_ID')!,secretAccessKey:Deno.env.get('CUSTOMER_R2_SECRET_ACCESS_KEY')!,service:'s3',region:'auto',retries:0});
  stage='r2-export';
  const r2=await exportR2Assets({sign:signer.sign.bind(signer)});
  if(recipientFingerprint(recipient)!=='88a0dc3d153b25ad499b646014d28aea55348c9fb575017097e0bbdb8f3910e3')return json({error:'Recovery recipient unavailable'},503);
  const proof={ok:true,...storage.proof,...r2.proof,project_ref:project,source_commit:sha,run_id:run,source_files_deleted:false,source_public_access_changed:false,customer_notifications_sent:false,production_cutover:false};
  stage='owner-encryption';
  const sealed=sealPrivateDelivery(Buffer.from(JSON.stringify({schema:1,kind:'storage-and-r2-assets',project_ref:project,source_commit:sha,run_id:run,created_at:new Date().toISOString(),storage,r2,verification:proof})),recipient,{project_ref:project,source_commit:sha,run_id:run},'assets');
  return json({proof,envelope:sealed.toString('base64')});
 }catch{return json({error:'Private assets verification unavailable',stage},503);}
});
