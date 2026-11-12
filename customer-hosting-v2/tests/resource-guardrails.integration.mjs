import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resourceDatabase} from './helpers/resource-db.mjs';
const ADMIN='11111111-1111-4111-8111-111111111111',HASH='a'.repeat(64);
test('atomic upload and AI guardrails on synthetic SQL data',async t=>{
 const db=await resourceDatabase();t.after(()=>db.close());
 const base=(await readFile(new URL('./fixtures/hosting-base.sql',import.meta.url),'utf8')).replace(/create role ([a-z_]+) ([^;]+);/g,(_,name,attrs)=>`do $role$ begin create role ${name} ${attrs}; exception when duplicate_object then null; end $role$;`);
 await db.exec(base);await db.exec(await readFile(new URL('./fixtures/resource-storage.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261112123022_website_resource_guardrails.sql',import.meta.url),'utf8'));
 await db.exec("insert into public.website_sites(site_id,status) values('8100','request_waiting'),('8101','request_waiting'); insert into public.website_jobs(id,site_id,status) values(1,'8100','running'),(2,'8100','running'),(3,'8101','running')");
 const q=(sql,args=[])=>db.query(sql,args);
 const rpc=async(name,args)=>{const r=await q('select public.website_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args);return r.rows[0].value;};
 const upload=(site='8100',id=crypto.randomUUID())=>rpc('upload_reserve',[site,id,'top_photos','image.png']);
 const ai=(job=1,id=crypto.randomUUID(),input=10000,output=1000)=>rpc('ai_reserve',[job,id,'gpt-6.1-sol',HASH,input,output]);
 async function reset(){await db.exec("reset role; truncate public.website_upload_reservations,public.website_ai_charges; update public.website_resource_limits set upload_enabled=true,ai_enabled=true,upload_bucket_bytes=800000000,upload_site_bytes=400000000,ai_job_micro_usd=2000000,ai_site_month_micro_usd=4000000,ai_day_micro_usd=3000000,ai_month_micro_usd=10000000,pricing_checked_on=(clock_timestamp() at time zone 'UTC')::date; update storage.buckets set public=false; set role service_role");}
 await t.test('initial defaults disable both paid generation and signing',async()=>{
  await db.exec('set role service_role');await assert.rejects(upload(),/UPLOAD_DISABLED/);await assert.rejects(ai(),/AI_DISABLED/);
 });
 await t.test('only the one public flag is readable; all quota mutation/RPCs stay server-only',async()=>{
  await reset();await db.exec('set role authenticated');
  assert.equal((await q('select upload_enabled from public.website_resource_limits')).rows[0].upload_enabled,true);
  await assert.rejects(q('select ai_month_micro_usd from public.website_resource_limits'),/permission denied/);
  await assert.rejects(upload(),/permission denied/);await assert.rejects(ai(),/permission denied/);
  for(const table of ['website_upload_reservations','website_ai_charges'])await assert.rejects(q('select * from public.'+table),/permission denied/);
  await db.exec('set role anon');await assert.rejects(q('select upload_enabled from public.website_resource_limits'),/permission denied/);
 });
 await t.test('authenticated direct insert/update is denied while other buckets are unaffected',async()=>{
  await reset();await db.exec('set role authenticated');
  await assert.rejects(q("insert into storage.objects(bucket_id,name) values('website-intake-files','8100/bypass.png')"),/row-level security/);
  assert.equal((await q("update storage.objects set name='changed.png' where bucket_id='website-intake-files' returning id")).rows.length,0);
  await q("insert into storage.objects(bucket_id,name) values('other-business','unaffected.png')");
  await db.exec('reset role');await q("update public.website_resource_limits set upload_enabled=false");await db.exec('set role authenticated');
  await q("insert into storage.objects(bucket_id,name) values('website-intake-files','legacy/off-mode.png')");
  await db.exec("reset role; delete from storage.objects where name='legacy/off-mode.png'; set role service_role");
 });
 await t.test('a missing configuration row cannot reopen direct authenticated uploads',async()=>{
  await reset();await db.exec('reset role; delete from public.website_resource_limits; set role authenticated');
  await assert.rejects(q("insert into storage.objects(bucket_id,name) values('website-intake-files','8100/missing-config.png')"),/row-level security/);
  await db.exec('set role service_role');await assert.rejects(upload(),/no rows/);await assert.rejects(ai(),/no rows/);
  await db.exec('reset role; insert into public.website_resource_limits(id) values(true); set role service_role');
 });
 await t.test('private bucket, MIME, extension, folder and current site state are checked before signing',async()=>{
  await reset();await assert.rejects(rpc('upload_reserve',['8100',crypto.randomUUID(),'../another','a.png']),/UPLOAD_INVALID/);
  await assert.rejects(rpc('upload_reserve',['8100',crypto.randomUUID(),'top_photos','a.html']),/UPLOAD_INVALID/);
  await q("update public.website_sites set status='customer_review' where site_id='8100'");await assert.rejects(upload(),/UPLOAD_STATE/);
  await q("update public.website_sites set status='request_waiting' where site_id='8100'");
  await db.exec('reset role');await q('update storage.buckets set public=true');await db.exec('set role service_role');await assert.rejects(upload(),/UPLOAD_BUCKET_UNSAFE/);
 });
 await t.test('bucket capacity includes legacy objects and worst-case signed paths; expiry never refunds',async()=>{
  await reset();await q('update public.website_resource_limits set upload_bucket_bytes=14000000');
  const r=await upload();assert.match(r.path,/^8100\/secure-intake\/top_photos\/[-a-f0-9]+-image.png$/);
  await assert.rejects(upload('8101'),/UPLOAD_CAPACITY/);
  await q("update public.website_upload_reservations set created_at=clock_timestamp()-interval '1 year'");
  await assert.rejects(upload('8101'),/UPLOAD_CAPACITY/);
  assert.equal((await q("select count(*)::int as n from storage.objects where bucket_id='website-intake-files'")).rows[0].n,1);
 });
 await t.test('per-site capacity and rolling rate limits cannot be bypassed by fresh request IDs',async()=>{
  await reset();await q('update public.website_resource_limits set upload_site_bytes=7000000');await upload();await assert.rejects(upload(),/UPLOAD_CAPACITY/);await upload('8101');
  await reset();await q("insert into public.website_upload_reservations(reservation_id,site_id,object_path) select gen_random_uuid(),'8100','8100/fake/'||n from generate_series(1,60)n");
  await assert.rejects(upload(),/UPLOAD_RATE_LIMIT/);
 });
 await t.test('each paid request must name a running job and a reviewed model with bounded token counts',async()=>{
  await reset();await assert.rejects(rpc('ai_reserve',[1,crypto.randomUUID(),'expensive-unknown',HASH,10000,1000]),/AI_INVALID/);
  await assert.rejects(ai(1,crypto.randomUUID(),300000,1000),/AI_INVALID/);
  await q("update public.website_jobs set status='queued' where id=1");await assert.rejects(ai(),/AI_JOB_STATE/);await q("update public.website_jobs set status='running' where id=1");
 });
 await t.test('exact request IDs cannot be reused; actual usage releases only the unused conservative amount',async()=>{
  await reset();const id=crypto.randomUUID(),r=await ai(1,id);assert.equal(r.reserved_micro_usd,60000);
  await assert.rejects(ai(1,id),/duplicate key/);
  await rpc('ai_settle',[id,'resp_fixture',100,10]);await rpc('ai_settle',[id,'resp_fixture',100,10]);
  assert.equal(Number((await q('select charged_micro_usd from public.website_ai_charges where request_id=$1',[id])).rows[0].charged_micro_usd),600);
  await assert.rejects(rpc('ai_settle',[id,'resp_different',0,0]),/AI_SETTLEMENT_CONFLICT/);
 });
 await t.test('job, site, daily and monthly budgets each reject overspend before dispatch',async()=>{
  for(const scope of ['ai_job_micro_usd','ai_site_month_micro_usd','ai_day_micro_usd','ai_month_micro_usd']){
   await reset();await q('update public.website_resource_limits set '+scope+'=100000');await ai();
   await assert.rejects(ai(scope==='ai_site_month_micro_usd'?2:scope==='ai_day_micro_usd'||scope==='ai_month_micro_usd'?3:1),/AI_BUDGET/);
  }
 });
 await t.test('unresolved calls remain charged across calendar resets and pricing review cannot expire silently',async()=>{
  await reset();const id=crypto.randomUUID();await ai(1,id);await rpc('ai_uncertain',[id]);
  await q("update public.website_ai_charges set created_at=clock_timestamp()-interval '2 months'");await q('update public.website_resource_limits set ai_day_micro_usd=100000');await assert.rejects(ai(3),/AI_BUDGET/);
  await q("update public.website_resource_limits set pricing_checked_on=(clock_timestamp() at time zone 'UTC')::date-31");await assert.rejects(ai(3),/AI_PRICING_REVIEW/);
 });
 await t.test('a job has at most 40 paid dispatch attempts even when its budget is increased',async()=>{
  await reset();await q('update public.website_resource_limits set ai_job_micro_usd=100000000,ai_site_month_micro_usd=100000000,ai_day_micro_usd=100000000,ai_month_micro_usd=100000000');
  for(let i=0;i<40;i++)await ai();await assert.rejects(ai(),/AI_ATTEMPTS/);
 });
 await t.test('unexpected token usage is recorded and automatically pauses future paid calls',async()=>{
  await reset();const id=crypto.randomUUID();await ai(1,id);const r=await rpc('ai_settle',[id,'resp_overrun',10001,1000]);assert.equal(r.overrun,true);await assert.rejects(ai(),/AI_DISABLED/);
 });
 await t.test('operators can inspect aggregate reservations without prompts, customer tokens or provider keys',async()=>{
  await reset();await upload();await ai();const info=await rpc('resource_usage',[ADMIN,'8100']);assert.equal(info.upload_reserved_bytes,7000000);assert.equal(info.ai_month_micro_usd,60000);assert.equal(info.usage_is_provider_invoice,false);
  await assert.rejects(rpc('resource_usage',['22222222-2222-4222-8222-222222222222','8100']),/Administrator required/);
 });
 if(db.independent)await t.test('independent PostgreSQL sessions cannot oversubscribe the last upload or AI capacity',async()=>{
  await reset();const other=await db.independent();try{
   await db.exec('begin');await upload();await other.query('set role service_role');
   await assert.rejects(other.query('select public.website_upload_reserve($1,$2,$3,$4)',['8101',crypto.randomUUID(),'top_photos','image.png']),/could not obtain lock/);
   await db.exec('rollback');await q('update public.website_resource_limits set upload_bucket_bytes=14000000');await upload();
   await assert.rejects(other.query('select public.website_upload_reserve($1,$2,$3,$4)',['8101',crypto.randomUUID(),'top_photos','image.png']),/UPLOAD_CAPACITY/);
   await db.exec('begin');await ai();await assert.rejects(other.query('select public.website_ai_reserve($1,$2,$3,$4,$5,$6)',[3,crypto.randomUUID(),'gpt-6.1-sol',HASH,10000,1000]),/could not obtain lock/);await db.exec('rollback');
  }finally{await other.end();}
 });
 await t.test('encrypted PostgreSQL dump restores records, grants and Storage RLS in another disposable database',{skip:!db.backupRoundTrip},async()=>{
  const proof=await db.backupRoundTrip();assert.equal(proof.records_identical,true);console.log('APPLICATION_DB_BACKUP_RESTORE_PASS '+JSON.stringify(proof));
 });
});
