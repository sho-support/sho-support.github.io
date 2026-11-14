import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {edgeHarness,postgrestFixture} from './helpers/edge-harness.mjs';
const key='synthetic-intake-access-token-only',ADMIN='11111111-1111-4111-8111-111111111111';
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
test('actual HTTP routes reserve upload capacity and every paid worker path uses the same ledger',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(await readFile(new URL('./fixtures/hosting-base.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./fixtures/resource-storage.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261112123022_website_resource_guardrails.sql',import.meta.url),'utf8'));
 await db.exec("alter table public.website_jobs add column created_at timestamptz default now(),add column started_at timestamptz,add column error_message text; insert into public.website_sites(site_id,status,repo_full_name) values('8100','request_waiting','sho-support/site-8100'); update public.website_resource_limits set upload_enabled=true,ai_enabled=true,pricing_checked_on=(clock_timestamp() at time zone 'UTC')::date");
 await db.query("insert into public.website_orders(order_code,site_id,plan,customer_access_token_hash) values('P8100','8100','one',$1)",[await digest(key)]);
 await db.exec('set role service_role');const admin=postgrestFixture(db),signed=[];let failSigning=false;
 admin.storage={from:bucket=>({createSignedUploadUrl:async(path,options)=>{assert.equal(bucket,'website-intake-files');assert.equal(options.upsert,false);signed.push(path);return failSigning?{error:Error('private signer diagnostic')}:{data:{path,token:'synthetic-upload-token'}};}})};
 const users={admin:{id:ADMIN},customer:{id:'22222222-2222-4222-8222-222222222222'}};
 const send=async(h,body,token='customer')=>{const r=await h.handler(new Request('https://fixtureproject.supabase.co/functions/v1/fixture',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
 for(const slug of ['website-api','website-customer-access'])await t.test(`${slug}: signing follows a durable reservation; denial and signing failure cannot refund it`,async()=>{
  const h=await edgeHarness({slug:slug+'/index.ts',admin,users,roleResolver:async()=> 'owner'}),body={action:'signed_upload',site_id:'8100',key,folder:'top_photos',file_name:'日本語の画像.PNG'};
  const before=signed.length,r=await send(h,body);assert.equal(r.status,200,JSON.stringify(r));assert.equal(signed.length,before+1);assert.match(r.body.path,/^8100\/secure-intake\/top_photos\/.+\.png$/);
  assert.equal(Number((await db.query('select count(*) as n from public.website_upload_reservations where object_path=$1',[r.body.path])).rows[0].n),1);
  assert.equal((await send(h,{...body,folder:'../8101'})).status,400);assert.equal(signed.length,before+1);
  failSigning=true;const failed=await send(h,body);failSigning=false;assert.equal(failed.status,503);assert.ok(!JSON.stringify(failed).includes('diagnostic'));
  const reservations=Number((await db.query('select count(*) as n from public.website_upload_reservations')).rows[0].n);assert.equal(reservations,signed.length);
  await db.query('update public.website_resource_limits set upload_site_bytes=7000000');assert.equal((await send(h,body)).status,429);assert.equal(signed.length,before+2);
  await db.query('update public.website_resource_limits set upload_site_bytes=400000000');
  assert.equal(h.requests.length+h.messages.length+h.background.length,0);
 });
 await t.test('viewer credentials cannot issue upload tokens or read operator cost records',async()=>{
  const h=await edgeHarness({slug:'website-api/index.ts',admin,users,roleResolver:async()=> 'viewer'});
  assert.equal((await send(h,{action:'signed_upload',site_id:'8100',folder:'top_photos',file_name:'a.png'})).status,403);
  assert.equal((await send(h,{action:'admin_resource_usage',site_id:'8100'})).status,403);
 });
 await t.test('operator cost records require both authenticated admin membership and the server RPC',async()=>{
  const h=await edgeHarness({slug:'website-api/index.ts',admin,users,roleResolver:async(_admin,user)=>user===ADMIN?'admin':'owner'});
  assert.equal((await send(h,{action:'admin_resource_usage',site_id:'8100'})).status,403);
  const r=await send(h,{action:'admin_resource_usage',site_id:'8100'},'admin');assert.equal(r.status,200);assert.equal(r.body.resources.usage_is_provider_invoice,false);
 });
 for(const [i,plan]of ['one','semi','full'].entries())await t.test(`${plan}: provider failure leaves the actual worker stopped and charged without automatic requeue`,async()=>{
  const id=100+i,kind=plan==='semi'?'sho_revision':'initial_create';
  await db.query("update public.website_sites set status='building' where site_id='8100'");
  await db.query("insert into public.website_jobs(id,site_id,status,kind,instruction) values($1,'8100','queued',$2,'見出しを変更してください')",[id,kind]);
  await db.query("insert into public.website_intakes(site_id,payload) values('8100',$1) on conflict(site_id) do update set payload=excluded.payload",[JSON.stringify({fields:{build_plan:plan,template_style:plan==='semi'?'rock':''},files:{},members:[]})]);
  const paid=[];const h=await edgeHarness({slug:'website-worker/index.ts',admin,env:{SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role',OPENAI_API_KEY:'synthetic-ai-key',GITHUB_PAGES_TOKEN:'synthetic-source-key'},fetcher:async(url,options={})=>{
   if(url==='https://api.openai.com/v1/responses'){paid.push(JSON.parse(options.body));return Response.json({error:'PRIVATE_PROVIDER_DIAGNOSTIC'},{status:429});}
   assert.equal(options.method||'GET','GET','No GitHub write should occur before a generation has succeeded');
   if(url==='https://api.github.com/repos/sho-support/site-8100')return Response.json({full_name:'sho-support/site-8100',private:true,default_branch:'main'});
   if(url==='https://api.github.com/repos/sho-support/site-8100/git/trees/main?recursive=1')return Response.json({tree:[]});
   if(url==='https://sho-web-support.netlify.app/website-template-preview.html?style=rock')return new Response('<html data-theme="rock"><style>body{color:white}</style></html>');
   throw Error('Unapproved fixture HTTP '+url);
  }});
  const r=await send(h,{site_id:'8100'},'synthetic-service-role');assert.equal(r.status,202);await Promise.all(h.background);
  assert.equal(paid.length,1,'Actual worker used the guarded AI path');assert.equal(paid[0].store,false);assert.equal(paid[0].service_tier,'default');assert.ok(paid[0].max_output_tokens>0);if(plan==='semi')assert.equal(paid[0].max_output_tokens,3000);
  const row=(await db.query('select status,error_message from public.website_jobs where id=$1',[id])).rows[0];assert.equal(row.status,'error');assert.match(row.error_message,/自動再試行/);assert.ok(!row.error_message.includes('PRIVATE_PROVIDER'));
  const charge=(await db.query('select * from public.website_ai_charges where job_id=$1',[id])).rows[0];assert.equal(charge.state,'uncertain');assert.equal(charge.charged_micro_usd,charge.reserved_micro_usd);
  assert.equal(h.background.length,1,'Only the original background job exists; no automatic worker wake-up');
 });
});
