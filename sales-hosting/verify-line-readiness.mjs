import {mkdir,writeFile} from 'node:fs/promises';
const endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-sales-readiness';
async function json(url,options={}){
 const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error('HTTP_'+response.status);
 const raw=await response.text();if(raw.length>16000)throw Error('Unexpected response size');return JSON.parse(raw);
}
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/sales-cloudflare'||process.env.GITHUB_EVENT_NAME!=='push')throw Error('Fixed CI identity required');
 let ready=false;
 for(let attempt=0;attempt<7;attempt++){
  try{ready=(await json(endpoint)).build===process.env.GITHUB_SHA;}catch{}
  if(ready)break;
  if(attempt<6)await new Promise(resolve=>setTimeout(resolve,10000));
 }
 if(!ready)throw Error('Pinned readiness deployment is not available');
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Unexpected OIDC issuer endpoint');
 url.searchParams.set('audience','sho-line-readiness');
 const token=await json(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
 if(typeof token.value!=='string'||token.value.length>12000)throw Error('OIDC credential unavailable');
 const r=await json(endpoint,{method:'POST',headers:{authorization:'Bearer '+token.value,'content-type':'application/json'},body:'{"action":"line_check"}'});
 const fields=['credential_valid','official_account_matches','webhook_configured','webhook_active','signed_empty_webhook_verified','real_message_receipt_verified'];
 if(r.ok!==true||r.build!==process.env.GITHUB_SHA||fields.some(k=>typeof r.line?.[k]!=='boolean')||r.real_messages_sent!==0||r.configuration_changed!==false)throw Error('Unexpected LINE proof');
 const proof={checked_at:new Date().toISOString(),source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,
  ...Object.fromEntries(fields.map(k=>[k,r.line[k]])),authentication_mode:r.line.authentication_mode,reason:r.line.reason,real_messages_sent:0,configuration_changed:false,real_order_created:false,real_payment:false,production_cutover:false};
 await mkdir('test-results',{recursive:true});await writeFile('test-results/sales-line-readiness.json',JSON.stringify(proof,null,2)+'\n');
 console.log('LINE_READINESS_RESULT',JSON.stringify(proof));
 if(!r.line.signed_empty_webhook_verified)process.exitCode=1;
}catch(error){console.error('LINE_READINESS_STOPPED',error instanceof Error&&/^HTTP_\d+$/.test(error.message)?error.message:'No credentials or provider response bodies are logged.');process.exitCode=1;}
