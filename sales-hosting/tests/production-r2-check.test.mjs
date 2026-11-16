import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedProductionR2Claims,createProductionR2Handler,verifyProductionR2,ACCOUNT,BUCKET} from '../production-r2-check/check.mjs';
const run='43850000000',sha='a'.repeat(40),now=1800000000;
const claims={repository:'sho-support/sho-support.github.io',repository_id:'1224256882',repository_owner_id:'275386651',ref:'refs/heads/architecture/sales-cloudflare',event_name:'push',run_attempt:'1',workflow_ref:'sho-support/sho-support.github.io/.github/workflows/sales-production-r2.yml@refs/heads/architecture/sales-cloudflare',run_id:run,sha,workflow_sha:sha,iat:now,exp:now+300};
const values={CUSTOMER_R2_ACCOUNT_ID:ACCOUNT,CUSTOMER_R2_BUCKET:BUCKET,CUSTOMER_R2_ACCESS_KEY_ID:'synthetic-private-id',CUSTOMER_R2_SECRET_ACCESS_KEY:'synthetic-private-secret'};
const env=name=>values[name];
const sign=async request=>{request.headers.set('x-fixture-signed','true');return request;};
function fixture({scope=403,production=200,corrupt=false}={}){
 const calls=[],objects=new Map();
 return {calls,objects,fetch:async request=>{
  assert.equal(request.headers.get('x-fixture-signed'),'true');
  assert.equal(request.redirect,'error');
  const url=new URL(request.url);assert.equal(url.hostname,ACCOUNT+'.r2.cloudflarestorage.com');
  assert.match(url.pathname,/\/sites\/9000001002\/releases\/[a-f0-9]{64}\/connectivity-check\.json$/);
  calls.push([request.method,url.pathname]);
  if(url.pathname.startsWith('/sho-customer-sites-preview/')){assert.equal(request.method,'HEAD');return new Response(null,{status:scope});}
  assert.ok(url.pathname.startsWith('/'+BUCKET+'/'));assert.ok(!url.pathname.endsWith('active.json'));
  if(production!==200)return new Response('synthetic-private-secret',{status:production});
  const key=url.pathname;
  if(request.method==='PUT'){
   assert.equal(request.headers.get('if-none-match'),'*');assert.ok(!objects.has(key));
   const bytes=await request.text();assert.ok(bytes.length<256);
   objects.set(key,{bytes,headers:{etag:'"fixture-etag"','content-length':String(new TextEncoder().encode(bytes).length),'content-type':'application/json','x-amz-meta-sha256':request.headers.get('x-amz-meta-sha256')}});
   return new Response(null,{headers:{etag:'"fixture-etag"'}});
  }
  if(request.method==='DELETE'){objects.delete(key);return new Response(null,{status:204});}
  const entry=objects.get(key);if(!entry)return new Response(null,{status:404});
  return new Response(request.method==='GET'?(corrupt?'X'.repeat(entry.bytes.length):entry.bytes):null,{headers:entry.headers});
 }};
}
test('CI identity binds exact repository, owner, workflow, branch, run, source, attempt and time',()=>{
 assert.equal(allowedProductionR2Claims(claims,run,sha,now),true);
 for(const [key,value] of [['repository','other/repo'],['repository_id','1'],['repository_owner_id','1'],['ref','refs/heads/main'],['event_name','pull_request'],['run_attempt','2'],['workflow_ref','other'],['run_id','43850000001'],['sha','b'.repeat(40)],['workflow_sha','b'.repeat(40)],['exp',now],['iat',now-601]])assert.equal(allowedProductionR2Claims({...claims,[key]:value},run,sha,now),false,key);
});
test('default, expired, browser, unauthenticated and caller-selected requests cannot start storage I/O',async()=>{
 let checked=0;
 const args={run,sha,until:(now+300)*1000,now:()=>now*1000,verify:async token=>token==='signed-fixture',check:async()=>{checked++;return {ok:true};}};
 const make=(body='{"action":"verify"}',token='signed-fixture',origin)=>new Request('https://fixture.invalid',{method:'POST',headers:{authorization:'Bearer '+token,...(origin?{origin}: {})},body});
 for(const [handler,request,status] of [[createProductionR2Handler({...args,run:'__ALLOWED_RUN_ID__'}),make(),403],[createProductionR2Handler({...args,until:now*1000-1}),make(),403],[createProductionR2Handler(args),make(undefined,undefined,'https://evil.invalid'),403],[createProductionR2Handler(args),make(undefined,'invalid'),401],[createProductionR2Handler(args),make('{"action":"verify","bucket":"other"}'),400]])assert.equal((await handler(request)).status,status);
 assert.equal(checked,0);assert.equal((await createProductionR2Handler(args)(make())).status,200);assert.equal(checked,1);
});
test('missing credentials and enabled commercial hosting make no storage requests',async()=>{
 for(const replacements of [{CUSTOMER_R2_ACCOUNT_ID:''},{CUSTOMER_R2_BUCKET:''},{CUSTOMER_R2_SECRET_ACCESS_KEY:''},{WEBSITE_CUSTOMER_HOSTING:'cloudflare-r2'}]){
  const f=fixture();const r=await verifyProductionR2({run,sha,sign,env:name=>({...values,...replacements})[name],fetch:f.fetch});assert.equal(r.ok,false);assert.equal(r.failed_step,'configuration');assert.equal(f.calls.length,0);
 }
});
test('identifier mistakes never select another target or count as ready configuration',async()=>{
 for(const [replacements,issue] of [[{CUSTOMER_R2_ACCOUNT_ID:ACCOUNT+' '},'surrounding_whitespace'],[{CUSTOMER_R2_ACCOUNT_ID:'"'+ACCOUNT+'"'},'quoted_value'],[{CUSTOMER_R2_ACCOUNT_ID:'CUSTOMER_R2_ACCOUNT_ID='+ACCOUNT},'assignment_in_value'],[{CUSTOMER_R2_ACCOUNT_ID:'f'.repeat(64)},'digest_shaped_value']]){
  const f=fixture();const r=await verifyProductionR2({run,sha,sign,env:name=>({...values,...replacements,CUSTOMER_R2_BUCKET:'sho-customer-sites-preview'})[name],fetch:f.fetch});
  assert.equal(r.ok,false);assert.equal(r.storage_access_verified,true);assert.equal(r.failed_step,'configuration');assert.equal(r.identifier_issues.account,issue);assert.equal(r.identifier_issues.bucket,'previous_preview_bucket');assert.equal(f.objects.size,0);
 }
});
test('real transport contract verifies read/write/checksum, rejects preview access and removes only its synthetic object',async()=>{
 const f=fixture(),r=await verifyProductionR2({run,sha,env,sign,fetch:f.fetch});
 assert.equal(r.ok,true);for(const name of ['write_verified','head_verified','read_back_verified','preview_access_denied','cleanup_verified'])assert.equal(r[name],true,name);
 assert.equal(f.objects.size,0);assert.deepEqual(f.calls.map(x=>x[0]),['HEAD','PUT','HEAD','GET','HEAD','DELETE','HEAD']);
 assert.ok(!JSON.stringify(r).includes('synthetic-private'));assert.equal(r.customer_data_accessed,false);assert.equal(r.production_cutover,false);
});
test('wrong or overbroad credentials never produce a successful scope proof; created bytes are cleaned',async()=>{
 for(const options of [{production:403},{scope:404},{scope:200}]){
  const f=fixture(options),r=await verifyProductionR2({run,sha,env,sign,fetch:f.fetch});assert.equal(r.ok,false);assert.equal(f.objects.size,0);assert.ok(!JSON.stringify(r).includes('synthetic-private-secret'));
  if(options.production)assert.equal(r.provider_status,403);else{assert.equal(r.failed_step,'preview_scope');assert.equal(r.cleanup_verified,true);}
 }
});
test('checksum mismatch cannot be marked as a read-back success and still cleans its own object',async()=>{
 const f=fixture({corrupt:true}),r=await verifyProductionR2({run,sha,env,sign,fetch:f.fetch});assert.equal(r.ok,false);assert.equal(r.failed_step,'read_back');assert.equal(r.cleanup_verified,true);assert.equal(f.objects.size,0);
});
