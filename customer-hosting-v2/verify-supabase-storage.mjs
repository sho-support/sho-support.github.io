import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-resource-qa';
const unauth=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(15000)});
assert.equal(unauth.status,401,'Unauthenticated calls must fail before any resource work');
const url=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,bootstrap=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
assert.ok(url&&bootstrap,'The isolated GitHub OIDC job identity is required');
const tokenResult=await fetch(url+(url.includes('?')?'&':'?')+'audience=sho-resource-preview',{headers:{Authorization:'Bearer '+bootstrap},redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(tokenResult.status,200);
const {value}=await tokenResult.json();assert.ok(value,'OIDC token is present');
const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+value,'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(90000)});
// Never print the bearer token, provider errors or private SDK payloads.
const proof=await response.json();assert.equal(response.status,200,'Isolated Storage test must succeed; step='+(/^[a-z_]+$/.test(proof.step||'')?proof.step:'authentication-or-initialization'));
assert.equal(proof.ok,true);assert.equal(proof.source_commit,process.env.GITHUB_SHA);assert.equal(proof.run_id,process.env.GITHUB_RUN_ID);assert.equal(proof.checks.length,9);assert.equal(proof.production_bucket_modified,false);
await mkdir('.wrangler/proof',{recursive:true});await writeFile('.wrangler/proof/supabase-storage.json',JSON.stringify(proof,null,2)+'\n');
console.log('LIVE SUPABASE STORAGE PASS; checks='+proof.checks.length+'; real_orders=0; ai_requests=0');
