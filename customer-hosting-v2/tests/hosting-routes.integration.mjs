import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {stageRelease} from '../src/release-publisher.mjs';
import {edgeHarness,postgrestFixture} from './helpers/edge-harness.mjs';

const ADMIN='11111111-1111-4111-8111-111111111111',CUSTOMER='22222222-2222-4222-8222-222222222222',STRANGER='33333333-3333-4333-8333-333333333333';
const DOMAIN='routes.example';
const hash=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))),b=>b.toString(16).padStart(2,'0')).join('');
const page=title=>'<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title></head><body><h1>'+title+'</h1></body></html>';
test('actual Supabase HTTP handlers use the shared Cloudflare protocol',async t=>{
  const sql=new PGlite();const runtime=new Miniflare(convertV4MiniflareOptions({
    modules:['../worker.mjs','../src/site-router.mjs'].map(path=>({type:'ESModule',path:fileURLToPath(new URL(path,import.meta.url))})),
    compatibilityDate:'2026-11-07',r2Buckets:{SITES:'routes-local-only'},bindings:{CUSTOMER_BASE_DOMAIN:DOMAIN}
  }));
  t.after(async()=>{await runtime.dispose();await sql.close();});
  await sql.exec(await readFile(new URL('./fixtures/hosting-base.sql',import.meta.url),'utf8'));
  await sql.exec(await readFile(new URL('../../supabase/migrations/20261112053755_website_cloudflare_publication_protocol.sql',import.meta.url),'utf8'));
  await sql.exec('set role service_role');
  const admin=postgrestFixture(sql),raw=await runtime.getR2Bucket('SITES');
  const env={WEBSITE_CUSTOMER_HOSTING:'cloudflare-r2',CUSTOMER_BASE_DOMAIN:DOMAIN,CUSTOMER_HOSTING_DOMAIN_READY:DOMAIN,
    SUPABASE_URL:'https://fixtureproject.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-not-a-real-key',LINE_OWNER_USER_ID:'U_FAKE_OWNER'};
  const users={admin:{id:ADMIN},customer:{id:CUSTOMER},stranger:{id:STRANGER}};
  const access=await edgeHarness({slug:'website-customer-access/index.ts',admin,bucket:raw,users,env});
  const api=await edgeHarness({slug:'website-api/index.ts',admin,bucket:raw,users,env});
  const preview=await edgeHarness({slug:'website-preview/index.ts',admin,bucket:raw,users,env});
  const rpc=async(name,args)=>{const r=await admin.rpc('website_hosting_'+name,args);if(r.error)throw r.error;return r.data;};
  const send=async(h,body,token)=>{
    const response=await h.handler(new Request('https://fixtureproject.supabase.co/functions/v1/'+h.slug,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));
    return {status:response.status,body:await response.json()};
  };
  async function order(n,plan){
    const code=({one:'P',semi:'S',full:'F'}[plan])+n;
    await sql.query('insert into public.website_orders(order_code,plan,line_user_id) values($1,$2,$3)',[code,plan,'U_FAKE_'+n]);
    const url=await rpc('reserve_url',{p_actor:ADMIN,p_order:code,p_domain:DOMAIN});
    await sql.query('update public.website_orders set selections=$1 where order_code=$2',[JSON.stringify({final_public_domain:url.public_url,final_quote_amount:plan==='one'?15000:plan==='semi'?22000:30000,final_quote_sent_at:'2026-11-12T00:00:00Z',quote_domain_owner_confirmed_at:'2026-11-12T00:00:00Z'}),code]);
    const r=await send(access,{action:'admin_activate_order',order_code:code},'admin');assert.equal(r.status,200);assert.equal(r.body.site_id,n);
    await sql.query('insert into public.website_site_users(site_id,user_id,role) values($1,$2,$3)',[n,CUSTOMER,'owner']);
    return n;
  }
  async function stage(n,title){
    const id=crypto.randomUUID().replace(/-/g,''),job=(await sql.query("insert into public.website_jobs(site_id,status) values($1,'running') returning id",[n])).rows[0].id;
    await stageRelease({bucket:raw,siteId:n,releaseId:id,files:[{path:'index.html',content:page(title)}]});
    const m=await raw.get(`sites/${n}/release-manifests/${id}.json`);
    await sql.query("update public.website_sites set status='sho_review',repo_full_name=$1 where site_id=$2",['sho-support/site-'+n,n]);
    await rpc('register_release',{p_site:n,p_job:job,p_release:id,p_commit:'b'.repeat(40),p_manifest:await hash(await m.text()),p_quality:{ok:true}});
    await sql.query("update public.website_jobs set status='sho_review' where id=$1",[job]);return id;
  }
  const view=(id,key,path='index.html')=>preview.handler(new Request(`https://fixtureproject.supabase.co/functions/v1/website-preview?id=${id}&key=${key}&path=${encodeURIComponent(path)}`));
  for(const[i,plan]of['one','semi','full'].entries())await t.test(`${plan}: atomic activation, admin review, both approval routes, publish, update link and private state`,async()=>{
    const n=await order(String(8100+i),plan),release=await stage(n,plan+' frozen A');
    assert.equal((await send(access,{action:'admin_publish_site',site_id:n,approved:true})).status,401);
    assert.equal((await send(api,{action:'admin_publish_site',site_id:n,approved:true},'customer')).status,403);
    assert.equal((await send(access,{action:'admin_publish_site',site_id:n},'admin')).status,409);
    const review=await send(api,{action:'admin_transition',status:'customer_review',site_id:n},'admin');assert.equal(review.status,200);
    const key=new URL(review.body.review_url).searchParams.get('key');
    const first=await view(n,key);assert.equal(first.status,200);assert.match((await first.json()).html,/frozen A/);
    const publicBefore=await runtime.dispatchFetch('https://s'+n+'.'+DOMAIN+'/');assert.equal(publicBefore.status,404);
    assert.equal((await send(api,{action:'review_action',review_action:'approve',site_id:n},'stranger')).status,403);
    const approve=i===1?await send(api,{action:'review_action',review_action:'approve',site_id:n},'customer'):
      await send(access,{action:'review_approve',site_id:n,key});
    assert.equal(approve.status,200);assert.equal(approve.body.release_id,release);
    assert.equal((await send(api,{action:'review_action',review_action:'publish',site_id:n},'customer')).status,403);
    const published=await send(access,{action:'admin_publish_site',site_id:n},'admin');assert.equal(published.status,200);assert.equal(published.body.status,'live');
    assert.match(await(await runtime.dispatchFetch('https://s'+n+'.'+DOMAIN+'/')).text(),/frozen A/);
    assert.equal((await view(n,key)).status,403,'The private preview ends after publication');
    const loaded=await send(access,{action:'review_load',site_id:n,key});assert.equal(loaded.status,200);
    assert.equal(new URL(loaded.body.update_url).searchParams.get('key'),key);
    assert.equal((await sql.query('select customer_access_token_hash from public.website_orders where site_id=$1',[n])).rows[0].customer_access_token_hash,await hash(key));
    const updated=await send(access,{action:'update_status',site_id:n,key});assert.equal(updated.status,200);assert.equal(updated.body.analytics_available,false);
    const noticeCount=access.messages.length;
    assert.equal((await send(access,{action:'admin_publish_site',site_id:n},'admin')).status,200);
    assert.equal(access.messages.length,noticeCount,'A duplicate publish does not send duplicate LINE messages');
    assert.equal((await send(api,{action:'admin_domain',site_id:n,custom_domain:'different.example'},'admin')).status,409);
    assert.equal((await send(api,{action:'admin_transition',status:'private',site_id:n},'admin')).status,200);
    assert.equal((await runtime.dispatchFetch('https://s'+n+'.'+DOMAIN+'/')).status,404);
  });
  await t.test('a revision atomically revokes its review token and queues exactly one job',async()=>{
    const n=await order('8200','one');await stage(n,'Revision A');
    const r=await send(api,{action:'admin_transition',site_id:n,status:'customer_review'},'admin'),key=new URL(r.body.review_url).searchParams.get('key');
    const revision={action:'review_revision',site_id:n,key,detail:'見出しの文章を変更してください。'};
    assert.equal((await send(access,revision)).status,200);assert.equal((await send(access,revision)).status,409);
    const jobs=await sql.query("select count(*)::int as n from public.website_jobs where site_id=$1 and status='queued'",[n]);assert.equal(jobs.rows[0].n,1);
    assert.equal((await send(access,{action:'review_approve',site_id:n,key})).status,409);
    assert.equal((await view(n,key)).status,403);
  });
  await t.test('tenant preview tokens and unapproved publish requests cannot select another tenant',async()=>{
    const n=await order('8201','one');await stage(n,'Other tenant');
    const r=await send(api,{action:'admin_transition',site_id:n,status:'customer_review'},'admin'),key=new URL(r.body.review_url).searchParams.get('key');
    assert.equal((await view('8200',key)).status,403);
    assert.equal((await view(n,key,'../active.json')).status,403);
    const loaded=await send(access,{action:'review_load',site_id:n,key});
    assert.equal(loaded.status,200);assert.ok(!JSON.stringify(loaded.body).includes('token_hash'));assert.ok(!JSON.stringify(loaded.body).includes('repo_full_name'));
    assert.equal((await send(access,{action:'admin_publish_site',site_id:n,key,approved:true},'stranger')).status,403);
    assert.equal((await send(api,{action:'admin_publish_site',site_id:n,approved:true},'admin')).status,409);
  });
  await t.test('the next source branch starts from the active restored commit, rather than a stale GitHub branch',async()=>{
    const n='8100';
    const active=(await sql.query('select active_release from public.website_hosting_sites where site_id=$1',[n])).rows[0].active_release;
    await sql.query('update public.website_hosting_releases set source_commit=$1 where site_id=$2 and release_id=$3',['c'.repeat(40),n,active]);
    const calls=[];
    const h=await edgeHarness({slug:'_shared/hosting-service.ts',admin,bucket:raw,users,env:{...env,GITHUB_PAGES_TOKEN:'SYNTHETIC_SOURCE_TOKEN'},fetcher:async(url,options)=>{
      calls.push({url,options});return Response.json({ref:'fixture'},{status:201});
    }});
    const branch=await h.module.namespace.beginHostingSourceBranch(admin,{site_id:n,repo_full_name:'sho-support/site-'+n});
    assert.match(branch,/^sho-review-[a-f0-9-]{36}$/);assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://api.github.com/repos/sho-support/site-8100/git/refs');
    assert.equal(JSON.parse(calls[0].options.body).sha,'c'.repeat(40));
  });
  assert.equal(access.requests.length+api.requests.length+preview.requests.length,0,'No HTTP request may leave the local fixture');
});

test('all live-helper snapshots block Pages, domain and merge mutations when Cloudflare is enabled',async()=>{
  for(const slug of ['website-api','website-customer-access','website-worker','website-preview']){
    const h=await edgeHarness({slug:slug+'/_shared/website.ts',admin:{},legacyHelper:true,env:{WEBSITE_CUSTOMER_HOSTING:'cloudflare-r2'}});
    for(const fn of ['setGithubPagesSource','setGithubPagesDomain','publishApprovedStagedBranch'])if(h.module.namespace[fn]){
      await assert.rejects(h.module.namespace[fn]('sho-support/site-1000','main',null),/disabled/);
    }
    assert.equal(h.requests.length,0);
  }
});
