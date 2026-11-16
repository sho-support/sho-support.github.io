import test from 'node:test';
import assert from 'node:assert/strict';
import {readinessSummary} from '../supabase-storage-probe/configuration.mjs';
test('readiness inspection returns only whitelisted boolean flags and never a secret, URL, digest or length',()=>{
 const names=[],canary='PRIVATE-CREDENTIAL-NEVER-RETURN',r=readinessSummary(n=>{names.push(n);return n==='CUSTOMER_R2_ACCOUNT_ID'?'bdb1bb4a771be8595d5564d5d78cb1d4':n==='CUSTOMER_R2_BUCKET'?'sho-customer-sites-preview':n==='WEBSITE_CUSTOMER_HOSTING'?'cloudflare-r2':canary;});
 assert.equal(r.account_matches,true);assert.equal(r.bucket_is_preview,true);assert.equal(r.hosting_enabled,true);assert.ok(Object.values(r.configured).every(x=>x===true));
 assert.ok(!JSON.stringify(r).includes(canary));assert.equal(names.length,6);assert.ok(!names.includes('SUPABASE_SERVICE_ROLE_KEY'));
 assert.ok(Object.values(readinessSummary(()=>undefined).configured).every(x=>x===false));
});
