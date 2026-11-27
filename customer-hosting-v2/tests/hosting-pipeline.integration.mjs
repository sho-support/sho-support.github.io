import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {stageRelease,readPublication} from '../src/release-publisher.mjs';
import {createHostingPublisher,PublicationUncertainError} from '../../supabase/functions/_shared/hosting-publication.mjs';

const ADMIN='11111111-1111-4111-8111-111111111111';
const KEY='a'.repeat(64),DOMAIN='pipeline.example';
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
const html=title=>`<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

test('three-plan SQL + workerd/R2 publication pipeline and failure recovery',async t=>{
  const sql=new PGlite();
  const runtime=new Miniflare(convertV4MiniflareOptions({
    modules:['../worker.mjs','../src/site-router.mjs'].map(path=>({type:'ESModule',path:fileURLToPath(new URL(path,import.meta.url))})),
    compatibilityDate:'2026-11-07',r2Buckets:{SITES:'pipeline-local-only'},bindings:{CUSTOMER_BASE_DOMAIN:DOMAIN}
  }));
  t.after(async()=>{await runtime.dispose();await sql.close();});
  await sql.exec(await readFile(new URL('./fixtures/hosting-base.sql',import.meta.url),'utf8'));
  await sql.exec(await readFile(new URL('../../supabase/migrations/20261112053755_website_cloudflare_publication_protocol.sql',import.meta.url),'utf8'));
  await sql.exec('set role service_role');
  const q=(text,args=[])=>sql.query(text,args);
  const raw=await runtime.getR2Bucket('SITES');
  const db={
    rpc:async(name,args)=>{const values=Object.values(args);return(await q(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as r`,values.map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].r;},
    hosting:async id=>(await q('select * from public.website_hosting_sites where site_id=$1',[id])).rows[0],
    operation:async id=>(await q('select * from public.website_hosting_operations where operation_id=$1',[id])).rows[0],
    release:async(id,r)=>(await q('select * from public.website_hosting_releases where site_id=$1 and release_id=$2',[id,r])).rows[0]
  };
  const publisher=(database=db,bucket=raw)=>createHostingPublisher({db:database,storeForSite:()=>bucket});
  const rpc=(name,...args)=>db.rpc('website_hosting_'+name,Object.fromEntries(args.map((v,i)=>['p'+i,v])));
  async function fixture(n,plan='one'){
    const code=({one:'P',semi:'S',full:'F'}[plan])+n;
    await q('insert into public.website_orders(order_code,plan) values($1,$2)',[code,plan]);
    const u=await rpc('reserve_url',ADMIN,code,DOMAIN);
    await q('insert into public.website_sites(site_id,public_url) values($1,$2)',[n,u.public_url]);
    await q("update public.website_orders set status='site_created',site_id=$1,selections=$2 where order_code=$3",[n,JSON.stringify({final_public_domain:u.public_url}),code]);
    await rpc('enrol',ADMIN,n);
    return {siteId:n,actorId:ADMIN};
  }
  async function staged(ctx,title){
    const id=(await digest(ctx.siteId+title+crypto.randomUUID())).slice(0,32);
    const job=(await q("insert into public.website_jobs(site_id,status) values($1,'running') returning id",[ctx.siteId])).rows[0].id;
    await stageRelease({bucket:raw,siteId:ctx.siteId,releaseId:id,files:[{path:'index.html',content:html(title)}]});
    const m=await raw.get(`sites/${ctx.siteId}/release-manifests/${id}.json`);
    await rpc('register_release',ctx.siteId,job,id,'b'.repeat(40),await digest(await m.text()),{ok:true});
    await q("update public.website_jobs set status='sho_review' where id=$1",[job]);
    await rpc('open_review',ADMIN,ctx.siteId,id,KEY);await rpc('approve',ctx.siteId,id,KEY,null);
    return {...ctx,releaseId:id};
  }
  const page=id=>runtime.dispatchFetch(`https://s${id}.${DOMAIN}/`);
  const pointer=id=>readPublication({bucket:raw,siteId:id});
  const losePutResponse=bucket=>({get:(...a)=>bucket.get(...a),head:(...a)=>bucket.head(...a),
    async put(key,...args){const r=await bucket.put(key,...args);if(key.endsWith('/active.json'))throw new Error('Synthetic lost PUT response');return r;}});

  for(const [i,plan] of ['one','semi','full'].entries())await t.test(`${plan}: order reservation -> approved frozen release -> public HTML -> update -> restored HTML`,async()=>{
    const ctx=await fixture(String(6100+i),plan),a=await staged(ctx,`${plan} A`);
    assert.equal((await page(ctx.siteId)).status,404,'Staging and approval do not publish');
    const first=await publisher().publish(a);assert.equal(first.state,'committed');
    assert.match(await(await page(ctx.siteId)).text(),new RegExp(`${plan} A`));
    const b=await staged(ctx,`${plan} B`);
    assert.match(await(await page(ctx.siteId)).text(),new RegExp(`${plan} A`),'New staged files cannot leak through the live URL');
    await publisher().publish(b);assert.match(await(await page(ctx.siteId)).text(),new RegExp(`${plan} B`));
    await publisher().publish({...a,kind:'rollback'});assert.match(await(await page(ctx.siteId)).text(),new RegExp(`${plan} A`));
    assert.equal((await db.hosting(ctx.siteId)).active_publication_id,(await pointer(ctx.siteId)).publication_id);
    await publisher().publish({...a,kind:'private'});assert.equal((await page(ctx.siteId)).status,404);
    assert.equal((await db.hosting(ctx.siteId)).public_url,'https://s'+ctx.siteId+'.'+DOMAIN+'/');
  });
  await t.test('a successful R2 write with a lost response is committed by reconciliation without another write',async()=>{
    const a=await staged(await fixture('6200'),'Lost response A');
    let error;try{await publisher(db,losePutResponse(raw)).publish(a);}catch(e){error=e;}
    assert.ok(error instanceof PublicationUncertainError);
    assert.equal((await db.hosting(a.siteId)).active_operation_id,error.operationId);
    const nonce=(await pointer(a.siteId)).publication_id;
    assert.equal((await publisher().reconcile({...a,operationId:error.operationId})).state,'committed');
    assert.equal((await pointer(a.siteId)).publication_id,nonce);
  });
  for(const afterCommit of [false,true])await t.test(`DB finalize response lost ${afterCommit?'after':'before'} commit is recovered idempotently`,async()=>{
    const a=await staged(await fixture(afterCommit?'6202':'6201'),'DB loss');let fail=true;
    const flaky={...db,rpc:async(name,args)=>{
      if(name==='website_hosting_finalize'&&fail){fail=false;if(afterCommit)await db.rpc(name,args);throw new Error('Synthetic DB connection failure');}
      return db.rpc(name,args);
    }};
    let error;try{await publisher(flaky).publish(a);}catch(e){error=e;}
    assert.ok(error instanceof PublicationUncertainError);
    assert.equal((await publisher().reconcile({...a,operationId:error.operationId})).state,'committed');
    assert.equal((await q('select count(*)::int as n from public.website_hosting_outbox where site_id=$1',[a.siteId])).rows[0].n,1);
  });
  await t.test('a late first publish cannot escape an absent-state recovery fence',async()=>{
    const a=await staged(await fixture('6203'),'Late first publication');
    let release,entered;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
    const held={get:(...x)=>raw.get(...x),head:(...x)=>raw.head(...x),put:async(key,...x)=>{
      if(key.endsWith('/active.json')){entered();await gate;}return raw.put(key,...x);
    }};
    const pending=publisher(db,held).publish(a).catch(e=>e);await waiting;
    const id=(await db.hosting(a.siteId)).active_operation_id;
    const fixed=await publisher().reconcile({...a,operationId:id});assert.equal(fixed.state,'fenced');
    assert.equal((await page(a.siteId)).status,404);release();
    assert.ok(await pending instanceof PublicationUncertainError);
    assert.equal((await db.hosting(a.siteId)).active_operation_id,null);
    await publisher().publish(a);assert.match(await(await page(a.siteId)).text(),/Late first publication/);
  });
  await t.test('a lost fence response is recognized using its persisted nonce',async()=>{
    const a=await staged(await fixture('6204'),'Fence response loss');
    // A failure BEFORE the first PUT leaves an operation needing a barrier.
    const fails={get:(...x)=>raw.get(...x),head:(...x)=>raw.head(...x),put:async()=>{throw new Error('Before PUT');}};
    let error;try{await publisher(db,fails).publish(a);}catch(e){error=e;}
    const done=await publisher(db,losePutResponse(raw)).reconcile({...a,operationId:error.operationId});
    assert.equal(done.state,'fenced');assert.equal((await db.hosting(a.siteId)).active_operation_id,null);
  });
  await t.test('an unrecognized R2 winner is preserved and the durable lock remains',async()=>{
    const a=await staged(await fixture('6205'),'Unknown winner');
    const fails={get:(...x)=>raw.get(...x),head:(...x)=>raw.head(...x),put:async()=>{throw new Error('Before PUT');}};
    let error;try{await publisher(db,fails).publish(a);}catch(e){error=e;}
    const unknown=crypto.randomUUID();
    await raw.put(`sites/${a.siteId}/active.json`,JSON.stringify({status:'private',release:null,publication_id:unknown}));
    await assert.rejects(publisher().reconcile({...a,operationId:error.operationId}),PublicationUncertainError);
    assert.equal((await pointer(a.siteId)).publication_id,unknown);
    assert.equal((await db.hosting(a.siteId)).active_operation_id,error.operationId);
  });
  await t.test('a manifest with different bytes cannot be published despite a prior approval',async()=>{
    const a=await staged(await fixture('6206'),'Manifest tampering');
    const key=`sites/${a.siteId}/release-manifests/${a.releaseId}.json`,m=await raw.get(key);
    await raw.put(key,(await m.text())+' ');
    await assert.rejects(publisher().publish(a),PublicationUncertainError);
    assert.equal((await page(a.siteId)).status,404);
  });
});
