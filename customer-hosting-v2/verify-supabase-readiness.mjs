import {mkdir,writeFile} from 'node:fs/promises';
const endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-resource-qa';
async function json(url,options){
 const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Readiness request failed with status '+response.status);
 const raw=await response.text();if(raw.length>16000)throw Error('Unexpected readiness response size');return JSON.parse(raw);
}
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/customer-hosting-v2'||process.env.GITHUB_EVENT_NAME!=='push')throw Error('Readiness inspection requires the isolated architecture CI job');
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Unexpected OIDC issuer endpoint');
 url.searchParams.set('audience','sho-resource-preview');
 const token=await json(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
 if(typeof token.value!=='string'||token.value.length>12000)throw Error('OIDC credential unavailable');
 const r=await json(endpoint,{method:'POST',headers:{authorization:'Bearer '+token.value,'content-type':'application/json'},body:'{}'});
 const fields=['account_matches','bucket_is_preview','hosting_enabled','database_url_available'];
 const names=['CUSTOMER_R2_ACCOUNT_ID','CUSTOMER_R2_BUCKET','CUSTOMER_R2_ACCESS_KEY_ID','CUSTOMER_R2_SECRET_ACCESS_KEY'];
 if(r.ok!==true||r.run_id!==process.env.GITHUB_RUN_ID||r.source_commit!==process.env.GITHUB_SHA||r.purpose!=='configuration-only'||r.production_data_accessed!==false||r.external_customer_requests!==0||fields.some(k=>typeof r[k]!=='boolean')||names.some(k=>typeof r.configured?.[k]!=='boolean'))throw Error('Unexpected readiness proof');
 const proof={run_id:r.run_id,source_commit:r.source_commit,purpose:r.purpose,configured:Object.fromEntries(names.map(k=>[k,r.configured[k]])),...Object.fromEntries(fields.map(k=>[k,r[k]])),production_data_accessed:false,external_customer_requests:0};
 await mkdir(new URL('./.wrangler/proof/',import.meta.url),{recursive:true});
 await writeFile(new URL('./.wrangler/proof/supabase-readiness.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');
 console.log('SUPABASE_READINESS_VERIFIED',JSON.stringify(proof));
}catch(e){console.error('Readiness inspection stopped; no credentials or response bodies are logged. '+(e instanceof Error&&/^Readiness request failed with status \d+$/.test(e.message)?e.message:''));process.exitCode=1;}
