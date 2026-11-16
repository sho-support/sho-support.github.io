import {mkdir,writeFile} from 'node:fs/promises';
import {prepareProductionR2} from '../customer-hosting-v2/src/production-r2.mjs';
const endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-production-r2-check';
const flags=['account_matches','bucket_matches','hosting_enabled','write_verified','head_verified','read_back_verified','preview_access_denied','cleanup_verified','customer_data_accessed','public_access_changed','production_cutover'];
const secrets=['CUSTOMER_R2_ACCOUNT_ID','CUSTOMER_R2_BUCKET','CUSTOMER_R2_ACCESS_KEY_ID','CUSTOMER_R2_SECRET_ACCESS_KEY'];
async function json(url,options={}){
 const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(100000)});
 if(!response.ok)throw Error('HTTP_'+response.status);
 const raw=await response.text();if(raw.length>12000)throw Error('Unexpected response');return JSON.parse(raw);
}
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/sales-cloudflare'||process.env.GITHUB_EVENT_NAME!=='push')throw Error('Unexpected identity');
 let ready=false;
 for(let i=0;i<13;i++){
  try{ready=(await json(endpoint)).build===process.env.GITHUB_SHA;}catch{}
  if(ready)break;
  if(i<12)await new Promise(resolve=>setTimeout(resolve,10000));
 }
 if(!ready)throw Error('Pinned deployment unavailable');
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Unexpected issuer');
 url.searchParams.set('audience','sho-production-r2');
 const token=await json(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
 if(typeof token.value!=='string'||token.value.length>12000)throw Error('Token unavailable');
 const result=await json(endpoint,{method:'POST',headers:{authorization:'Bearer '+token.value,'content-type':'application/json'},body:'{"action":"verify"}'});
 if(result.source_commit!==process.env.GITHUB_SHA||result.run_id!==process.env.GITHUB_RUN_ID||result.purpose!=='production-r2-connectivity'
  ||flags.some(k=>typeof result[k]!=='boolean')||secrets.some(k=>typeof result.configured?.[k]!=='boolean'))throw Error('Unexpected proof');
 const proof={checked_at:new Date().toISOString(),source_commit:result.source_commit,run_id:result.run_id,ok:result.ok===true,
  configured:Object.fromEntries(secrets.map(k=>[k,result.configured[k]])),...Object.fromEntries(flags.map(k=>[k,result[k]]))};
 if(['configuration','initial_absence','write','head','read_back','preview_scope','cleanup'].includes(result.failed_step))proof.failed_step=result.failed_step;
 if(Number.isInteger(result.provider_status)&&result.provider_status>=400&&result.provider_status<=599)proof.provider_status=result.provider_status;
 // REST read token only. Never call the create path or alter public access.
 proof.bucket_metadata=await prepareProductionR2({token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,createIfAbsent:false});
 await mkdir('test-results',{recursive:true});await writeFile('test-results/sales-production-r2-connectivity.json',JSON.stringify(proof,null,2)+'\n');
 console.log('PRODUCTION_R2_RESULT',JSON.stringify(proof));
 if(!proof.ok||!proof.bucket_metadata.ready||proof.hosting_enabled||proof.customer_data_accessed||proof.public_access_changed||proof.production_cutover)process.exitCode=1;
}catch(error){console.error('PRODUCTION_R2_STOPPED',/^HTTP_\d+$/.test(error?.message||'')?error.message:'No credentials or provider response bodies are logged.');process.exitCode=1;}
