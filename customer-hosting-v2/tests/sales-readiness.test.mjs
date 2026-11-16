import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedReadinessClaims,checkLineConnection,createReadinessHandler,readinessAuthorization,ownerLineFixture,SALES_ORIGIN,WEBHOOK} from '../../supabase/functions/website-sales-readiness/readiness.mjs';
const ok=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
function lineFixture(responses){const calls=[];return {calls,fetch:async(url,options)=>{calls.push({url,...options});assert.equal(options.redirect,'error');const next=responses.shift();if(next instanceof Error)throw next;assert.ok(next,'Unexpected extra LINE call');return next;}};}
const request=(body={},token='owner',origin=SALES_ORIGIN)=>new Request('https://fixture.invalid',{method:'POST',headers:{origin,authorization:'Bearer '+token},body:JSON.stringify(body)});
test('LINE connection test uses only bot metadata and the empty-webhook validator',async()=>{
 const f=lineFixture([ok({basicId:'@144dlsxp',userId:'never-export-this'}),ok({endpoint:WEBHOOK,active:true}),ok({success:true,statusCode:200})]);
 const r=await checkLineConnection({token:'fixture-secret',fetch:f.fetch});assert.equal(r.signed_empty_webhook_verified,true);assert.equal(r.real_messages_sent,0);
 assert.equal(r.real_message_receipt_verified,false);assert.ok(!JSON.stringify(r).includes('never-export-this'));assert.ok(!JSON.stringify(r).includes('fixture-secret'));
 assert.deepEqual(f.calls.map(x=>[new URL(x.url).pathname,x.method]),[['/v2/bot/info','GET'],['/v2/bot/channel/webhook/endpoint','GET'],['/v2/bot/channel/webhook/test','POST']]);
 assert.equal(f.calls[2].body,'{}');assert.ok(!f.calls.some(x=>/message|profile|followers/.test(x.url)));
});
test('missing, invalid and wrong-account credentials cannot reach webhook validation',async()=>{
 const missing=lineFixture([]);assert.equal((await checkLineConnection({token:'',fetch:missing.fetch})).reason,'LINE_CREDENTIALS_MISSING');assert.equal(missing.calls.length,0);
 for(const response of [new Response('secret diagnostics',{status:401}),ok({basicId:'@another-account'})]){
  const f=lineFixture([response]),r=await checkLineConnection({token:'fixture-secret',fetch:f.fetch});assert.equal(r.signed_empty_webhook_verified,false);assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(r).includes('secret'));
 }
});
test('an altered or disabled webhook is reported and never changed or tested',async()=>{
 for(const settings of [{endpoint:'https://other.invalid',active:true},{endpoint:WEBHOOK,active:false}]){
  const f=lineFixture([ok({basicId:'@144dlsxp'}),ok(settings)]),r=await checkLineConnection({token:'fixture-secret',fetch:f.fetch});assert.equal(r.webhook_active,false);assert.equal(f.calls.length,2);
 }
});
test('malformed, oversized and lost LINE responses never expose provider diagnostics',async()=>{
 for(const response of [new Response('{invalid'),new Response('x'.repeat(65000)),new Error('fixture-secret')]){
  const f=lineFixture([response]),r=await checkLineConnection({token:'fixture-secret',fetch:f.fetch});assert.equal(r.credential_valid,false);assert.ok(!JSON.stringify(r).includes('fixture-secret'));
 }
});
test('auth uses current verified user and the administrator table, never user metadata',async()=>{
 const lookups=[];let owner=false;const admin={auth:{getUser:async token=>token==='bad'?{error:true}:{data:{user:{id:'actual-user',user_metadata:{admin:true}}}}},from:name=>({select(){return this;},eq(key,value){lookups.push([name,key,value]);return this;},maybeSingle:async()=>({data:owner?{user_id:'actual-user'}:null})})};
 const authorize=readinessAuthorization({admin});assert.equal(await authorize(''),null);assert.equal(await authorize('bad'),null);
 assert.equal((await authorize('valid')).kind,'forbidden');owner=true;assert.equal((await authorize('valid')).kind,'administrator');assert.deepEqual(lookups[0],['website_admins','user_id','actual-user']);
});
test('anonymous, foreign-origin and non-admin requests cannot cause LINE or settings requests',async()=>{
 let calls=0;const handler=createReadinessHandler({authorize:async t=>t?{kind:'forbidden'}:null,admin:{from(){calls++;throw Error();}},env:()=>'',fetch:async()=>{calls++;throw Error();}});
 assert.equal((await handler(request({action:'line_check'},''))).status,401);assert.equal((await handler(request({action:'line_check'}))).status,403);
 assert.equal((await handler(request({action:'line_check'},'owner','https://evil.invalid'))).status,403);assert.equal(calls,0);
});
test('concurrent and repeated administrator checks reuse one bounded LINE validation',async()=>{
 const f=lineFixture([ok({basicId:'@144dlsxp'}),ok({endpoint:WEBHOOK,active:true}),ok({success:true,statusCode:200})]);
 const handler=createReadinessHandler({authorize:async()=>({kind:'administrator'}),admin:{},env:()=> 'fixture-secret',fetch:f.fetch});
 const results=await Promise.all([handler(request({action:'line_check'})),handler(request({action:'line_check'}))]);assert.ok(results.every(r=>r.status===200));
 const repeated=await (await handler(request({action:'line_check'}))).json();assert.equal(repeated.cached,true);assert.equal(f.calls.length,3);
});
test('temporary CI claims default closed and require the exact short-lived repository run',()=>{
 const now=1794800000,run='43700000000',sha='a'.repeat(40),c={repository:'sho-support/sho-support.github.io',repository_id:'1224256882',repository_owner_id:'275386651',ref:'refs/heads/architecture/sales-cloudflare',event_name:'push',run_attempt:'1',workflow_ref:'sho-support/sho-support.github.io/.github/workflows/sales-line-readiness.yml@refs/heads/architecture/sales-cloudflare',run_id:run,sha,workflow_sha:sha,iat:now,exp:now+300};
 assert.equal(allowedReadinessClaims(c,'__ALLOWED_RUN_ID__','__ALLOWED_SHA__',now),false);assert.equal(allowedReadinessClaims(c,run,sha,now),true);
 for(const change of [{repository:'other/repo'},{repository_id:'1'},{repository_owner_id:'1'},{ref:'refs/heads/main'},{event_name:'pull_request'},{run_attempt:'2'},{workflow_ref:'other'},{run_id:'43700000001'},{sha:'b'.repeat(40)},{workflow_sha:'b'.repeat(40)},{exp:now-1},{iat:now-601}])assert.equal(allowedReadinessClaims({...c,...change},run,sha,now),false);
});
test('temporary CI can only check LINE and cannot read private setup state',async()=>{
 let queried=false;const handler=createReadinessHandler({authorize:async()=>({kind:'ci'}),admin:{from(){queried=true;throw Error();}},env:()=>''});
 assert.equal((await handler(request({action:'status'}))).status,403);assert.equal(queried,false);
 const result=await (await handler(request({action:'line_check'}))).json();assert.equal(result.line.reason,'LINE_CREDENTIALS_MISSING');assert.equal(result.real_messages_sent,0);
});
test('existing channel-ID/secret authentication uses only a 15-minute stateless token without rotating credentials',async()=>{
 const f=lineFixture([ok({access_token:'EPHEMERAL-PRIVATE-TOKEN',expires_in:900,token_type:'Bearer'}),ok({basicId:'@144dlsxp'}),ok({endpoint:WEBHOOK,active:true}),ok({success:true,statusCode:200})]);
 const r=await checkLineConnection({channelId:'123456',channelSecret:'PRIVATE-CHANNEL-SECRET',fetch:f.fetch});
 assert.equal(r.authentication_mode,'stateless');assert.equal(r.signed_empty_webhook_verified,true);assert.equal(r.configuration_changed,false);assert.equal(f.calls.length,4);
 assert.equal(f.calls[0].url,'https://api.line.me/oauth2/v3/token');assert.equal(f.calls[0].method,'POST');assert.equal(new URLSearchParams(f.calls[0].body).get('grant_type'),'client_credentials');
 assert.ok(!JSON.stringify(r).includes('EPHEMERAL-PRIVATE-TOKEN'));assert.ok(!JSON.stringify(r).includes('PRIVATE-CHANNEL-SECRET'));
});
test('invalid channel credentials stop after one authentication request and never expose its error body',async()=>{
 const f=lineFixture([new Response('PRIVATE-CHANNEL-SECRET',{status:401})]);const r=await checkLineConnection({channelId:'123456',channelSecret:'PRIVATE-CHANNEL-SECRET',fetch:f.fetch});assert.equal(r.reason,'LINE_AUTHENTICATION_FAILED');assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(r).includes('PRIVATE-CHANNEL-SECRET'));
});
test('owner status returns booleans and cannot export saved personal details or preview credentials',async()=>{
 const privateValue='PRIVATE-OWNER-DATA';
 const admin={from:table=>({select(){return this;},in:async()=>({data:[{key:'sales_identity',value:{legal_name:privateValue,address:privateValue,phone:privateValue,contact:privateValue}},{key:'bank_transfer_test',value:{message:'テスト銀行0000000'}}]}),limit:async()=>({error:{code:'PGRST205'}})})};
 const values={CUSTOMER_R2_ACCOUNT_ID:'bdb1bb4a771be8595d5564d5d78cb1d4',CUSTOMER_R2_BUCKET:'sho-customer-sites-preview',CUSTOMER_R2_ACCESS_KEY_ID:'PRIVATE-KEY-ID',CUSTOMER_R2_SECRET_ACCESS_KEY:'PRIVATE-KEY-SECRET'};
 const handler=createReadinessHandler({authorize:async()=>({kind:'administrator'}),admin,env:name=>values[name]});
 const r=await handler(request({action:'status'})),data=await r.json();assert.equal(r.status,200);assert.equal(data.configuration.seller_saved,true);assert.equal(data.configuration.hosting_schema_installed,false);assert.equal(data.configuration.production_storage_configured,false);assert.equal(data.configuration.test_bank_saved,true);
 assert.ok(!JSON.stringify(data).includes(privateValue));assert.ok(!JSON.stringify(data).includes('PRIVATE-KEY'));assert.equal(data.order_to_delivery_live_test_verified,false);
 values.CUSTOMER_R2_ACCOUNT_ID=' '+values.CUSTOMER_R2_ACCOUNT_ID+'\n';values.CUSTOMER_R2_BUCKET=' sho-customer-sites-production\r\n';
 const normalized=await (await handler(request({action:'status'}))).json();assert.equal(normalized.configuration.production_storage_configured,true);assert.equal(normalized.order_to_delivery_live_test_verified,false);
});
test('the owner-only LINE link is limited to a marked reserved test order and its exact pairing token',async()=>{
 const token='a'.repeat(40),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
 const fixture={schema:1,purpose:'line_connection_acceptance_only',order_code:'9000001001',link_token:token};
 const order={status:'pending_line',line_link_token_hash:hash,selections:{qa_purpose:'line_connection_acceptance_only'}};
 const result=await ownerLineFixture(fixture,order);assert.equal(result.real_order,false);assert.equal(result.real_payment,false);assert.equal(result.line_linked,false);assert.equal(new URL(result.open_line_url).hostname,'line.me');assert.match(decodeURIComponent(new URL(result.open_line_url).search),/実注文ではありません/);
 for(const changed of [{...fixture,order_code:'1000'},{...fixture,link_token:'b'.repeat(40)},{...fixture,purpose:'production'}])assert.equal(await ownerLineFixture(changed,order),null);
 assert.equal(await ownerLineFixture(fixture,{...order,status:'site_created'}),null);assert.equal(await ownerLineFixture(fixture,{...order,selections:{}}),null);
});
