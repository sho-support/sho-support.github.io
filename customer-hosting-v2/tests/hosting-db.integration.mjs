import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const ADMIN='11111111-1111-4111-8111-111111111111';
const CUSTOMER='22222222-2222-4222-8222-222222222222';
const STRANGER='33333333-3333-4333-8333-333333333333';
const DOMAIN='customer-sites.example';
const KEY='a'.repeat(64), COMMIT='b'.repeat(40), MANIFEST='c'.repeat(64);
const fixture=await readFile(new URL('./fixtures/hosting-base.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../../supabase/migrations/20261112053755_website_cloudflare_publication_protocol.sql',import.meta.url),'utf8');

// Native CI deliberately uses a disposable PostgreSQL 17 database. Never accept hosted URLs.
async function database(){
  if(!process.env.HOSTING_QA_DATABASE_URL)return new PGlite();
  const u=new URL(process.env.HOSTING_QA_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.pathname!=='/sho_hosting_qa')throw new Error('Only the local disposable sho_hosting_qa database is permitted');
  const {Client}=await import('pg');
  const c=new Client({connectionString:u.href}); await c.connect();
  return {query:c.query.bind(c),exec:async sql=>{await c.query(sql);},close:c.end.bind(c)};
}

test('server-only publication protocol on synthetic SQL data',async t=>{
  const db=await database();
  t.after(()=>db.close());
  await db.exec(fixture);await db.exec(migration);
  await db.exec('set role service_role');
  const q=(sql,args=[])=>db.query(sql,args);
  const rpc=async(name,args)=>{
    const r=await q(`select public.website_hosting_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
    return r.rows[0].result;
  };
  async function site(n,plan='one'){
    const code=({one:'P',semi:'S',full:'F'}[plan])+n;
    await q('insert into public.website_orders(order_code,plan) values($1,$2)',[code,plan]);
    const u=await rpc('reserve_url',[ADMIN,code,DOMAIN]);
    await q('insert into public.website_sites(site_id,public_url) values($1,$2)',[n,u.public_url]);
    await q("update public.website_orders set status='site_created',site_id=$1,selections=$2 where order_code=$3",[n,JSON.stringify({final_public_domain:u.public_url}),code]);
    await rpc('enrol',[ADMIN,n]);
    await q('insert into public.website_site_users(site_id,user_id,role) values($1,$2,$3)',[n,CUSTOMER,'owner']);
    return u;
  }
  async function release(n,id){
    const j=await q("insert into public.website_jobs(site_id,status) values($1,'running') returning id",[n]);
    const job=j.rows[0].id;
    await rpc('register_release',[n,job,id,COMMIT,MANIFEST,JSON.stringify({ok:true})]);
    await q("update public.website_jobs set status='sho_review' where id=$1",[job]);
    return job;
  }
  const pointer=(n,r,op,status='live')=>({site_id:n,release:r,publication_id:op,status,etag:'"'+op+'"'});
  const state=async n=>(await q('select * from public.website_hosting_sites where site_id=$1',[n])).rows[0];

  await t.test('URLs are reserved before payment and immutable across later changes',async()=>{
    await q("insert into public.website_orders(order_code,plan) values('P1100','one'),('S1100','semi'),('P1101','one')");
    const u=await rpc('reserve_url',[ADMIN,'P1100',DOMAIN]);
    assert.equal(u.public_url,'https://s1100.'+DOMAIN+'/');
    assert.equal((await rpc('reserve_url',[ADMIN,'P1100',DOMAIN])).public_url,u.public_url);
    await assert.rejects(rpc('reserve_url',[ADMIN,'P1100','different.example']),/immutable/);
    await assert.rejects(rpc('reserve_url',[ADMIN,'S1100',DOMAIN]),/unique/);
    await assert.rejects(rpc('reserve_url',[STRANGER,'P1101',DOMAIN]),/administrator/);
    await assert.rejects(rpc('reserve_url',[ADMIN,'P1101','sho-support.com']),/separately owned/);
    await q("update public.website_orders set selections='{\"final_public_domain\":\"https://old.github.io/site/\"}' where order_code='P1101'");
    await assert.rejects(rpc('reserve_url',[ADMIN,'P1101',DOMAIN]),/migration review/);
  });

  await t.test('anonymous and authenticated clients cannot read or invoke any protocol entry point',async()=>{
    for(const role of ['anon','authenticated']){
      await db.exec('set role '+role);
      await assert.rejects(q('select * from public.website_hosting_sites'),/permission denied/);
      await assert.rejects(rpc('reserve_url',[ADMIN,'P1100',DOMAIN]),/permission denied/);
      await assert.rejects(rpc('approve',['1100','a'.repeat(24),KEY,null]),/permission denied/);
      await assert.rejects(rpc('finalize',[crypto.randomUUID(),'{}',false]),/permission denied/);
    }
    await db.exec('set role service_role');
    const checks=await q("select proname,has_function_privilege('anon',p.oid,'EXECUTE') a,has_function_privilege('authenticated',p.oid,'EXECUTE') b from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'website_hosting_%'");
    assert.ok(checks.rows.length>=10);assert.ok(checks.rows.every(x=>!x.a&&!x.b));
    const tables=await q("select relname,relrowsecurity from pg_class where relname in ('website_hosting_urls','website_hosting_sites','website_hosting_releases','website_hosting_operations','website_hosting_outbox')");
    assert.equal(tables.rows.length,5);assert.ok(tables.rows.every(x=>x.relrowsecurity));
  });

  for(const [i,plan] of ['one','semi','full'].entries())await t.test(`${plan}: exact review -> publish -> update -> rollback -> private`,async()=>{
    const n=String(2100+i),a=(i+1).toString(16).repeat(24),b=(i+5).toString(16).repeat(24);
    const u=await site(n,plan);await release(n,a);
    await assert.rejects(rpc('claim',[ADMIN,n,crypto.randomUUID(),'publish',a,null]),/current release/);
    await assert.rejects(q("update public.website_sites set status='live',customer_approved=true where site_id=$1",[n]),/protocol/);
    await rpc('open_review',[ADMIN,n,a,KEY]);
    await assert.rejects(rpc('approve',[n,b,KEY,null]),/obsolete/);
    await assert.rejects(rpc('approve',[n,a,'f'.repeat(64),null]),/authority/);
    await assert.rejects(rpc('approve',[n,a,null,STRANGER]),/authority/);
    await rpc('approve',[n,a,KEY,null]);
    const id=crypto.randomUUID();const claimed=await rpc('claim',[ADMIN,n,id,'publish',a,null]);
    assert.equal(claimed.reused,false);
    await assert.rejects(rpc('claim',[ADMIN,n,crypto.randomUUID(),'publish',a,null]),/reconciliation/);
    await assert.rejects(q("insert into public.website_jobs(site_id,status) values($1,'queued')",[n]),/reconciliation/);
    await assert.rejects(q("insert into public.website_review_issues(site_id) values($1)",[n]),/reconciliation/);
    await assert.rejects(q("update public.website_sites set status='building' where site_id=$1",[n]),/reconciliation/);
    assert.equal((await rpc('claim',[ADMIN,n,id,'publish',a,null])).reused,true);
    await assert.rejects(rpc('finalize',[id,JSON.stringify(pointer(n,b,id)),false]),/does not match/);
    const pa=pointer(n,a,id);
    await rpc('finalize',[id,JSON.stringify(pa),false]);
    assert.equal((await rpc('finalize',[id,JSON.stringify(pa),false])).idempotent,true);
    assert.equal((await state(n)).public_url,u.public_url);
    const first=(await q('select * from public.website_sites where site_id=$1',[n])).rows[0];
    assert.equal(first.status,'live');assert.ok(first.published_at&&first.adjustment_free_until);
    assert.equal(Boolean(first.update_free_until),plan!=='one');
    await release(n,b);
    await assert.rejects(rpc('claim',[ADMIN,n,crypto.randomUUID(),'publish',b,JSON.stringify(pa)]),/current release/);
    await rpc('open_review',[ADMIN,n,b,KEY]);await rpc('approve',[n,b,null,CUSTOMER]);
    const next=crypto.randomUUID();await rpc('claim',[ADMIN,n,next,'publish',b,JSON.stringify(pa)]);
    const pb=pointer(n,b,next);await rpc('finalize',[next,JSON.stringify(pb),false]);
    const back=crypto.randomUUID();await rpc('claim',[ADMIN,n,back,'rollback',a,JSON.stringify(pb)]);
    const pr=pointer(n,a,back);await rpc('finalize',[back,JSON.stringify(pr),false]);
    assert.equal((await state(n)).active_release,a);
    const privateId=crypto.randomUUID();await rpc('claim',[ADMIN,n,privateId,'private',a,JSON.stringify(pr)]);
    await rpc('finalize',[privateId,JSON.stringify(pointer(n,a,privateId,'private')),false]);
    const end=(await q('select * from public.website_sites where site_id=$1',[n])).rows[0];
    assert.equal(end.status,'private');assert.equal(+new Date(end.published_at),+new Date(first.published_at));
    assert.equal(+new Date(end.adjustment_free_until),+new Date(first.adjustment_free_until));
    assert.equal((await q('select count(*)::int as n from public.website_hosting_outbox where site_id=$1',[n])).rows[0].n,4);
  });

  await t.test('revisions and newer jobs revoke approval; unresolved issues block review',async()=>{
    const n='3100',a='a'.repeat(24),b='b'.repeat(24);await site(n);await release(n,a);
    await q("insert into public.website_review_issues(site_id) values($1)",[n]);
    await assert.rejects(rpc('open_review',[ADMIN,n,a,KEY]),/resolved/);
    await q("update public.website_review_issues set status='confirmed' where site_id=$1",[n]);
    await rpc('open_review',[ADMIN,n,a,KEY]);await rpc('approve',[n,a,KEY,null]);
    await q("update public.website_sites set status='building',review_access_token_hash=null where site_id=$1",[n]);
    assert.equal((await state(n)).pending_release,null);
    await assert.rejects(rpc('approve',[n,a,KEY,null]),/obsolete/);
    await release(n,b);await rpc('open_review',[ADMIN,n,b,KEY]);await rpc('approve',[n,b,KEY,null]);
    await q("insert into public.website_jobs(site_id,status) values($1,'queued')",[n]);
    assert.equal((await state(n)).approved_release,null);
    await assert.rejects(rpc('claim',[ADMIN,n,crypto.randomUUID(),'publish',b,null]),/active/);
  });

  await t.test('unknown write results retain the lock; a persisted recovery fence permits a fresh attempt',async()=>{
    const n='4100',a='d'.repeat(24);await site(n);await release(n,a);
    await rpc('open_review',[ADMIN,n,a,KEY]);await rpc('approve',[n,a,KEY,null]);
    const id=crypto.randomUUID(),op=await rpc('claim',[ADMIN,n,id,'publish',a,null]);
    await rpc('mark_uncertain',[id,'r2_timeout']);
    assert.equal((await state(n)).active_operation_id,id);
    await assert.rejects(rpc('claim',[ADMIN,n,crypto.randomUUID(),'publish',a,null]),/reconciliation/);
    const barrier=pointer(n,null,op.fence_id,'private');
    await assert.rejects(rpc('finalize',[id,JSON.stringify(pointer(n,null,crypto.randomUUID(),'private')),true]),/does not match/);
    await rpc('finalize',[id,JSON.stringify(barrier),true]);
    const h=await state(n);assert.equal(h.active_operation_id,null);assert.equal(h.active_publication_id,op.fence_id);
    assert.equal(h.approved_release,a);
    const fresh=crypto.randomUUID();await rpc('claim',[ADMIN,n,fresh,'publish',a,JSON.stringify(barrier)]);
    await rpc('finalize',[fresh,JSON.stringify(pointer(n,a,fresh)),false]);
    assert.equal((await state(n)).status,'live');
  });

  await t.test('sites cannot borrow another tenant release, URL, approval or operation ID',async()=>{
    const n='5100',a='e'.repeat(24);await site(n);await release(n,a);
    await rpc('open_review',[ADMIN,n,a,KEY]);await rpc('approve',[n,a,KEY,null]);
    await assert.rejects(q('update public.website_sites set public_url=$1 where site_id=$2',['https://s2100.'+DOMAIN+'/',n]),/cannot be changed/);
    const id=crypto.randomUUID();await rpc('claim',[ADMIN,n,id,'publish',a,null]);
    await assert.rejects(rpc('finalize',[id,JSON.stringify(pointer('2100',a,id)),false]),/does not match/);
    await assert.rejects(rpc('claim',[ADMIN,'2100',id,'publish',a,null]),/another request/);
  });

  if(process.env.HOSTING_QA_DATABASE_URL)await t.test('independent PostgreSQL sessions reject concurrent publication and production without waiting',async()=>{
    const n='7100',a='9'.repeat(24);await site(n);await release(n,a);
    await rpc('open_review',[ADMIN,n,a,KEY]);await rpc('approve',[n,a,KEY,null]);
    const {Client}=await import('pg');const racer=new Client({connectionString:process.env.HOSTING_QA_DATABASE_URL});
    await racer.connect();await racer.query('set role service_role');
    const id=crypto.randomUUID();
    try{
      await q('begin');await rpc('claim',[ADMIN,n,id,'publish',a,null]);
      await assert.rejects(racer.query('select public.website_hosting_claim($1,$2,$3,$4,$5,$6)',[ADMIN,n,crypto.randomUUID(),'publish',a,null]),e=>e.code==='55P03');
      await assert.rejects(racer.query("insert into public.website_jobs(site_id,status) values($1,'queued')",[n]),e=>e.code==='55P03');
      await q('commit');
      assert.equal((await state(n)).active_operation_id,id);
    }catch(e){await q('rollback');throw e;}finally{await racer.end();}
  });
});
