import {createR2S3Store} from '../../supabase/functions/_shared/customer-r2.mjs';
export const ACCOUNT='bdb1bb4a771be8595d5564d5d78cb1d4';
export const BUCKET='sho-customer-sites-production';
const encoder=new TextEncoder();
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),x=>x.toString(16).padStart(2,'0')).join('');

export function allowedProductionR2Claims(c,run,sha,now=Math.floor(Date.now()/1000)){
 return /^\d{8,20}$/.test(run)&&/^[a-f0-9]{40}$/.test(sha)
  &&c.repository==='sho-support/sho-support.github.io'&&c.repository_id==='1224256882'&&c.repository_owner_id==='275386651'
  &&c.ref==='refs/heads/architecture/sales-cloudflare'&&c.event_name==='push'&&c.run_attempt==='1'
  &&c.workflow_ref==='sho-support/sho-support.github.io/.github/workflows/sales-production-r2.yml@refs/heads/architecture/sales-cloudflare'
  &&c.run_id===run&&c.sha===sha&&c.workflow_sha===sha
  &&Number.isInteger(c.exp)&&Number.isInteger(c.iat)&&c.exp>now&&c.exp<=now+600&&c.iat>=now-600&&c.iat<=now+30;
}

export function createProductionR2Handler({run,sha,until,verify,check,now=()=>Date.now()}){
 return async req=>{
  const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
  if(!/^\d{8,20}$/.test(run)||!/^[a-f0-9]{40}$/.test(sha)||!Number.isSafeInteger(until)||now()>until||req.headers.has('origin'))return json({error:'Closed'},403);
  if(req.method==='GET')return json({service:'website-production-r2-check',build:sha});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const token=/^Bearer (.+)$/.exec(req.headers.get('authorization')||'')?.[1];
  if(!token||token.length>12000)return json({error:'Unauthorized'},401);
  try{
   if(!await verify(token))return json({error:'Unauthorized'},401);
   const raw=await req.text();if(raw.length>100)return json({error:'Invalid request'},400);
   const body=JSON.parse(raw);
   if(body?.action!=='verify'||Object.keys(body).length!==1)return json({error:'Invalid request'},400);
   return json({run_id:run,source_commit:sha,purpose:'production-r2-connectivity',...await check()});
  }catch{return json({error:'Verification unavailable'},503);}
 };
}

// Fixed synthetic namespace only; no active pointer, database, customer content or public URLs.
export async function verifyProductionR2({env,run,sha,sign,fetch:transport=globalThis.fetch}){
 const names=['CUSTOMER_R2_ACCOUNT_ID','CUSTOMER_R2_BUCKET','CUSTOMER_R2_ACCESS_KEY_ID','CUSTOMER_R2_SECRET_ACCESS_KEY'];
 const proof={ok:false,configured:Object.fromEntries(names.map(name=>[name,!!env(name)])),
  account_matches:env(names[0])===ACCOUNT,bucket_matches:env(names[1])===BUCKET,
  hosting_enabled:env('WEBSITE_CUSTOMER_HOSTING')==='cloudflare-r2',
  write_verified:false,head_verified:false,read_back_verified:false,preview_access_denied:false,
  cleanup_verified:false,customer_data_accessed:false,public_access_changed:false,production_cutover:false};
 if(!Object.values(proof.configured).every(Boolean)||!proof.account_matches||!proof.bucket_matches||proof.hosting_enabled
   ||!/^\d{8,20}$/.test(run)||!/^[a-f0-9]{40}$/.test(sha))return {...proof,failed_step:'configuration'};
 const site='9000001002',release=await digest(run+':'+sha+':'+crypto.randomUUID());
 const key=`sites/${site}/releases/${release}/connectivity-check.json`;
 const contents=JSON.stringify({purpose:'synthetic-production-r2-connectivity',real_order:false,real_payment:false});
 const store=createR2S3Store({accountId:ACCOUNT,bucketName:BUCKET,siteId:site,sign,fetch:transport,timeoutMs:10000});
 let step='initial_absence',cleanup=false;
 async function request(bucket,method){
  const url=`https://${ACCOUNT}.r2.cloudflarestorage.com/${bucket}/${key}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);let response;
  try{
   const signed=await sign(new Request(url,{method,redirect:'error',signal:controller.signal}),{aws:{allHeaders:true}});
   if(!(signed instanceof Request)||signed.url!==url||signed.method!==method)throw Error('Rejected signer');
   response=await transport(signed,{redirect:'error',signal:controller.signal});return response.status;
  }finally{clearTimeout(timer);await response?.body?.cancel().catch(()=>{});}
 }
 try{
  if(await store.head(key)!==null)throw Error('Existing fixture');
  step='write';cleanup=true;
  const written=await store.put(key,contents,{onlyIf:{'if-none-match':'*'},httpMetadata:{contentType:'application/json'}});
  if(!written){cleanup=false;throw Error('Existing fixture');}proof.write_verified=true;
  step='head';const head=await store.head(key);
  proof.head_verified=head?.size===encoder.encode(contents).length&&head?.customMetadata?.sha256===await digest(contents);
  if(!proof.head_verified)throw Error('Metadata mismatch');
  step='read_back';const read=await store.get(key);
  proof.read_back_verified=!!read&&await read.text()===contents;
  if(!proof.read_back_verified)throw Error('Read mismatch');
  step='preview_scope';proof.preview_access_denied=await request('sho-customer-sites-preview','HEAD')===403;
  if(!proof.preview_access_denied)throw Error('Scope not verified');
 }catch(error){
  proof.failed_step=step;
  if(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599)proof.provider_status=error.status;
 }finally{
  if(cleanup){try{
   const deleted=await request(BUCKET,'DELETE');
   proof.cleanup_verified=[200,204].includes(deleted)&&await store.head(key)===null;
  }catch{proof.cleanup_verified=false;}}
 }
 proof.ok=proof.write_verified&&proof.head_verified&&proof.read_back_verified&&proof.preview_access_denied&&proof.cleanup_verified;
 if(!proof.ok&&!proof.failed_step)proof.failed_step='cleanup';
 return proof;
}
