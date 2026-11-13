import {mkdir,writeFile} from 'node:fs/promises';
const endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-resource-qa';
const secretNames=['CUSTOMER_R2_ACCOUNT_ID','CUSTOMER_R2_BUCKET','CUSTOMER_R2_ACCESS_KEY_ID','CUSTOMER_R2_SECRET_ACCESS_KEY'];
const booleans=['account_matches','bucket_is_preview','hosting_enabled','database_url_available'];
const checks=['configuration_present_and_preview_only','one_shot_run_claim','supabase_signed_r2_requests',
 'existing_fictional_fixture_verified','staged_and_unapproved_content_stays_private','approved_fixture_html_and_css_served_over_https',
 'complete_update_switches_html_and_css','concurrent_publication_has_exactly_one_winner','rollback_restores_previous_html_and_css',
 'verified_export_bytes_restore_as_a_new_release','interrupted_upload_cannot_replace_last_good_release','public_reader_rejects_writes_and_cross_customer_selection'];
let proof;
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/customer-hosting-v2'||process.env.GITHUB_EVENT_NAME!=='push')throw Error('Unexpected execution identity');
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Unexpected OIDC endpoint');
 url.searchParams.set('audience','sho-resource-preview');
 const issued=await fetch(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!issued.ok)throw Error('OIDC request failed');
 const token=await issued.json();
 if(typeof token.value!=='string'||token.value.length>12000)throw Error('OIDC credential unavailable');
 const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token.value,'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(180000)});
 const raw=await response.text();if(raw.length>20000)throw Error('Unexpected proof size');
 const r=JSON.parse(raw);
 if(r.run_id!==process.env.GITHUB_RUN_ID||r.source_commit!==process.env.GITHUB_SHA||r.purpose!=='supabase-r2-preview'
   ||r.fixture_only!==true||r.site_id!=='9000001000'||r.production_data_accessed!==false||r.external_customer_requests!==0
   ||r.real_notifications!==0||r.ai_requests!==0||r.production_functions_replaced!==false
   ||secretNames.some(k=>typeof r.configured?.[k]!=='boolean')||booleans.some(k=>typeof r[k]!=='boolean'))throw Error('Unexpected proof identity');
 proof={run_id:r.run_id,source_commit:r.source_commit,purpose:r.purpose,http_status:response.status,ok:r.ok===true,
  configured:Object.fromEntries(secretNames.map(k=>[k,r.configured[k]])),...Object.fromEntries(booleans.map(k=>[k,r[k]])),
  fixture_only:true,site_id:r.site_id,production_data_accessed:false,external_customer_requests:0,real_notifications:0,ai_requests:0,production_functions_replaced:false,
  checks:Array.isArray(r.checks)?r.checks.filter(x=>checks.includes(x)):[],production_approval_verified:false,separate_provider_backup_verified:false};
 if(!response.ok){
  const stages=new Set(['configuration','create_scoped_transport','one_shot_run_claim','verify_preview_worker','verify_reserved_baseline_pointer','verify_reserved_baseline_source','verify_https_fixture_html_and_css']);
  if(stages.has(r.step))proof.failed_step=r.step;
  if(Number.isInteger(r.provider_status)&&r.provider_status>=400&&r.provider_status<=599)proof.provider_status=r.provider_status;
 }else{
  if(r.ok!==true||!Object.values(proof.configured).every(Boolean)||!r.account_matches||!r.bucket_is_preview||r.hosting_enabled
    ||proof.checks.length!==checks.length||new Set(proof.checks).size!==checks.length
    ||r.production_approval_verified!==false||r.separate_provider_backup_verified!==false
    ||!/^[a-f0-9]{12,64}$/.test(r.active_release)||!Number.isSafeInteger(r.usage?.writes)||r.usage.writes>24
    ||!Number.isSafeInteger(r.usage?.reads)||r.usage.reads>240||!Number.isSafeInteger(r.usage?.uploaded_bytes)||r.usage.uploaded_bytes>65536)throw Error('Unexpected lifecycle proof');
  proof.active_release=r.active_release;
  proof.usage={writes:r.usage.writes,reads:r.usage.reads,uploaded_bytes:r.usage.uploaded_bytes};
 }
 await mkdir(new URL('./.wrangler/proof/',import.meta.url),{recursive:true});
 await writeFile(new URL('./.wrangler/proof/supabase-r2-preview.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');
 console.log('SUPABASE_R2_PREVIEW_PROOF',JSON.stringify(proof));
 if(!proof.ok)throw Error('Isolated verification did not pass');
}catch{console.error('Supabase R2 verification stopped. No credentials, tokens or provider response bodies are logged.');process.exitCode=1;}
