import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resourceDatabase} from './helpers/resource-db.mjs';
import {commercialPolicy,quoteInput,COMMERCIAL_ADMIN as ADMIN} from './helpers/commercial-fixture.mjs';
import {makeCommercialQuote,quoteRequest} from '../../supabase/functions/_shared/commercial-policy.mjs';

const migrations=[
  '20261112053755_website_cloudflare_publication_protocol.sql',
  '20261112123022_website_resource_guardrails.sql',
  '20261112170006_website_commercial_quote_protocol.sql'
];
const DOMAIN='upgrade.example',KEY='a'.repeat(64);
const hash=async text=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');

test('upgrade rehearsal on the live HP column and constraint structure, using fictional records only',async t=>{
  const db=await resourceDatabase();t.after(()=>db.close());
  const q=(sql,args=[])=>db.query(sql,args);
  const rpc=async(name,args)=>(await q('select public.website_hosting_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as v',args)).rows[0].v;
  const seed=await readFile(new URL('./fixtures/live-hp-structure-20261116.sql',import.meta.url),'utf8');
  await db.exec(seed);
  await db.exec(await readFile(new URL('./fixtures/resource-storage.sql',import.meta.url),'utf8'));
  await q('insert into auth.users(id) values($1)',[ADMIN]);
  await q('insert into public.website_admins(user_id) values($1)',[ADMIN]);
  await q("insert into public.website_settings(key,value) values('sales_identity',$1),('commercial_policy',$2),('bank_transfer_test',$3)",[
    JSON.stringify({legal_name:'架空の移行試験事業者',address:'架空の所在地',phone:'000-0000-0000',contact:'fixture@example.invalid'}),
    JSON.stringify({enabled:false,backup:{attested:false}}),
    JSON.stringify({message:'【テスト専用・振込禁止】テスト銀行 0000000',order_codes:[]})
  ]);
  await q("insert into public.website_sites(site_id,site_name) values('legacy-fixture','架空の既存サイト')");
  await q("insert into public.website_orders(order_code,plan,amount_from) values('P7999','one',15000)");
  const baseline=async()=>({
    settings:(await q('select key,value,updated_at from public.website_settings order by key')).rows,
    sites:(await q('select * from public.website_sites order by site_id')).rows,
    orders:(await q('select * from public.website_orders order by order_code')).rows
  });
  const before=await baseline();
  const baseColumns=(await q("select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows;
  const baseConstraints=(await q("select c.relname,n.conname,pg_get_constraintdef(n.oid) as definition from pg_constraint n join pg_class c on c.oid=n.conrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and n.contype in ('p','u','c','f') order by c.relname,n.conname")).rows;
  const apply=async()=>{for(const name of migrations)await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));};

  await t.test('the inspected ten-table baseline retains all 88 columns and 32 constraints',async()=>{
    assert.equal(new Set(baseColumns.map(x=>x.table_name)).size,10);
    assert.equal(baseColumns.length,88);assert.equal(baseConstraints.length,32);
    await assert.rejects(q("insert into public.website_jobs(site_id,status) values('legacy-fixture','running')"),/kind.*not-null|null value.*kind/i);
    await assert.rejects(q("update public.website_orders set status='invented' where order_code='P7999'"),/check constraint/i);
  });

  await t.test('all three pending migrations can be rehearsed and transactionally rolled back',async()=>{
    await db.exec('begin');
    try{await apply();assert.equal((await q("select count(*)::int n from pg_tables where schemaname='public' and (tablename like 'website_hosting_%' or tablename in ('website_resource_limits','website_upload_reservations','website_ai_charges'))")).rows[0].n,8);}
    finally{await db.exec('rollback');}
    assert.equal((await q("select to_regclass('public.website_hosting_urls') as relation")).rows[0].relation,null);
    assert.deepEqual(await baseline(),before);
  });

  await t.test('committing the upgrade preserves existing draft settings, rows and table constraints',async()=>{
    await db.exec('begin');try{await apply();await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}
    assert.deepEqual(await baseline(),before);
    const names=baseColumns.map(x=>x.table_name);
    const currentColumns=(await q("select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name=any($1::text[]) order by table_name,ordinal_position",[names])).rows;
    const currentConstraints=(await q("select c.relname,n.conname,pg_get_constraintdef(n.oid) as definition from pg_constraint n join pg_class c on c.oid=n.conrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and n.contype in ('p','u','c','f') and c.relname=any($1::text[]) order by c.relname,n.conname",[names])).rows;
    assert.deepEqual(currentColumns,baseColumns);assert.deepEqual(currentConstraints,baseConstraints);
    await q("update public.website_sites set current_note='架空の既存運用は継続' where site_id='legacy-fixture'");
  });

  await t.test('new quota switches stay off and protocol tables/RPCs stay server-only',async()=>{
    assert.deepEqual((await q('select upload_enabled,ai_enabled from public.website_resource_limits')).rows[0],{upload_enabled:false,ai_enabled:false});
    const tables=(await q("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and (relname like 'website_hosting_%' or relname in ('website_resource_limits','website_upload_reservations','website_ai_charges')) and relkind='r'")).rows;
    assert.equal(tables.length,8);assert.ok(tables.every(x=>x.relrowsecurity));
    const funcs=(await q("select proname,prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') a,has_function_privilege('authenticated',p.oid,'EXECUTE') b from pg_proc p where pronamespace='public'::regnamespace and (proname like 'website_hosting_%' or proname like 'website_ai_%' or proname='website_upload_reserve')")).rows;
    assert.ok(funcs.length>=20);assert.ok(funcs.every(x=>!x.prosecdef&&!x.a&&!x.b));
    await db.exec('set role anon');await assert.rejects(rpc('reserve_url',[ADMIN,'P7999',DOMAIN]),/permission denied/);
    await db.exec('set role service_role');await assert.rejects(rpc('reserve_url',['33333333-3333-4333-8333-333333333333','P7999',DOMAIN]),/administrator/);
  });

  for(const [i,plan] of ['one','semi','full'].entries())await t.test(plan+': quote, retry, acceptance and activation satisfy the live constraints',async()=>{
    const n=String(7900+i),code=({one:'P',semi:'S',full:'F'}[plan])+n,amount={one:15000,semi:22000,full:30000}[plan];
    await q("insert into public.website_settings(key,value) values('commercial_policy',$1) on conflict(key) do update set value=excluded.value",[JSON.stringify(commercialPolicy())]);
    await q("insert into public.website_orders(order_code,status,plan,amount_from,line_user_id) values($1,'pending_payment',$2,$3,$4)",[code,plan,amount,'U_FICTIONAL_'+n]);
    const reserved=await rpc('reserve_url',[ADMIN,code,DOMAIN]);
    const made=makeCommercialQuote({policy:commercialPolicy(),order:{order_code:code,plan,amount_from:amount,update_plan:'none'},request:quoteRequest(quoteInput(amount)),publicUrl:reserved.public_url,bankMessage:'架空の試験用振込先（外部送信なし）',quoteId:crypto.randomUUID()});
    const fingerprint=await hash(made.message);
    const args=[ADMIN,code,JSON.stringify(made.snapshot),made.message,fingerprint];
    const claimed=await rpc('claim_quote',args),retried=await rpc('claim_quote',args);
    assert.equal(retried.retry_key,claimed.retry_key);assert.equal(retried.message,claimed.message);
    await rpc('complete_quote',[ADMIN,code,fingerprint]);
    await assert.rejects(rpc('activate_order',[ADMIN,code,KEY]),/acceptance|contract/);
    assert.equal((await q('select count(*)::int n from public.website_sites where site_id=$1',[n])).rows[0].n,0,'failed activation rolls back all inserts');
    await rpc('accept_contract',[ADMIN,code,fingerprint,'架空の同意返信・移行試験用の記録']);
    assert.equal((await rpc('activate_order',[ADMIN,code,KEY])).site_id,n);
    assert.equal((await rpc('activate_order',[ADMIN,code,KEY])).already_active,true);
    const order=(await q('select status,selections from public.website_orders where order_code=$1',[code])).rows[0];
    assert.equal(order.status,'site_created');assert.equal(order.selections.commercial_quote.snapshot.policy.hosting.renewal_fee_jpy,6000);
    await assert.rejects(q("update public.website_orders set selections=jsonb_set(selections,'{final_quote_amount}','1') where order_code=$1",[code]),/immutable/);
    await q("insert into public.website_jobs(site_id,kind,status) values($1,'initial_create','running')",[n]);
  });
});
