import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareProductionR2,PRODUCTION_R2_ACCOUNT as accountId,PRODUCTION_R2_BUCKET as bucket} from '../src/production-r2.mjs';
const token='synthetic-token-never-a-real-secret';
const ok=result=>new Response(JSON.stringify({success:true,result}),{headers:{'content-type':'application/json'}});
function fixture(responses){const calls=[];return {calls,fetch:async(url,options)=>{calls.push({url,...options});assert.equal(options.redirect,'error');const next=responses.shift();if(next instanceof Error)throw next;assert.ok(next,'unexpected extra provider request');return next;}};}
const detail=()=>ok({name:bucket,storage_class:'Standard',jurisdiction:'default'});
test('production R2 rejects any other account before a network request',async()=>{
  const f=fixture([]);await assert.rejects(prepareProductionR2({token,accountId:'0'.repeat(32),fetch:f.fetch}),/CONFIGURATION/);assert.equal(f.calls.length,0);
});
test('missing bucket remains untouched during read-only inspection',async()=>{
  const f=fixture([new Response('',{status:404})]),r=await prepareProductionR2({token,accountId,fetch:f.fetch});
  assert.equal(r.status,'absent');assert.equal(r.creation_attempted,false);assert.equal(f.calls.length,1);
});
test('explicit preparation creates only the fixed Standard bucket and verifies private access',async()=>{
  const f=fixture([new Response('',{status:404}),detail(),detail(),ok({enabled:false}),ok({domains:[]})]);
  const r=await prepareProductionR2({token,accountId,createIfAbsent:true,fetch:f.fetch});
  assert.equal(r.ready,true);assert.equal(r.created,true);assert.equal(r.objects_written,false);
  assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
  assert.deepEqual(JSON.parse(f.calls[1].body),{name:bucket,locationHint:'apac',storageClass:'Standard'});
  assert.ok(f.calls.every(x=>x.url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/r2/buckets')));
});
test('a preexisting private bucket is reused without a mutation',async()=>{
  const f=fixture([detail(),ok({enabled:false}),ok({domains:[]})]);
  const r=await prepareProductionR2({token,accountId,createIfAbsent:true,fetch:f.fetch});assert.equal(r.ready,true);assert.equal(r.created,false);assert.ok(f.calls.every(x=>x.method==='GET'));
});
test('insufficient write permission is recorded without leaking the provider response or retrying',async()=>{
  const f=fixture([new Response('',{status:404}),new Response('do not print '+token,{status:403})]);
  const r=await prepareProductionR2({token,accountId,createIfAbsent:true,fetch:f.fetch});assert.equal(r.ready,false);assert.equal(r.stage,'create');assert.equal(r.http_status,403);assert.equal(f.calls.length,2);assert.ok(!JSON.stringify(r).includes(token));
});
test('an ambiguous create response is not retried',async()=>{
  const f=fixture([new Response('',{status:404}),new Error('transport '+token)]);
  const r=await prepareProductionR2({token,accountId,createIfAbsent:true,fetch:f.fetch});assert.equal(r.status,'creation_uncertain');assert.equal(r.automatic_retry_allowed,false);assert.equal(f.calls.length,2);assert.ok(!JSON.stringify(r).includes(token));
});
test('an unexpectedly public bucket is reported without changing its settings',async()=>{
  const f=fixture([detail(),ok({enabled:true}),ok({domains:[]})]);
  const r=await prepareProductionR2({token,accountId,createIfAbsent:true,fetch:f.fetch});assert.equal(r.ready,false);assert.equal(r.status,'public_access_requires_review');assert.ok(f.calls.every(x=>x.method==='GET'));
});
