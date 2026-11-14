import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resourceDatabase} from './helpers/resource-db.mjs';
import {edgeHarness,postgrestFixture} from './helpers/edge-harness.mjs';
import {makeCommercialQuote,quoteRequest} from '../../supabase/functions/_shared/commercial-policy.mjs';
import {commercialPolicy,quoteInput,COMMERCIAL_ADMIN as ADMIN} from './helpers/commercial-fixture.mjs';
const STRANGER='33333333-3333-4333-8333-333333333333',HASH='a'.repeat(64),DOMAIN='contract.example';
const hash=async x=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))).toString('hex');
test('frozen commercial contract and acceptance on synthetic SQL and actual Edge handlers',async t=>{
 const db=await resourceDatabase();t.after(()=>db.close());
 const base=await readFile(new URL('./fixtures/hosting-base.sql',import.meta.url),'utf8');
 await db.exec(base);
 for(const name of ['20261112053755_website_cloudflare_publication_protocol.sql','20261112170006_website_commercial_quote_protocol.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec('set role service_role');
 const q=(s,v=[])=>db.query(s,v),rpc=async(name,args)=>{const r=await q('select public.website_hosting_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as v',args);return r.rows[0].v;};
 const savePolicy=async p=>q("insert into public.website_settings(key,value) values('commercial_policy',$1) on conflict(key) do update set value=excluded.value",[JSON.stringify(p)]);
 await q("insert into public.website_settings(key,value) values('bank_transfer',$1)",[JSON.stringify({message:'架空の銀行・支店・口座番号・名義（実際には送信しません）'})]);
 const env={WEBSITE_CUSTOMER_HOSTING:'cloudflare-r2',CUSTOMER_BASE_DOMAIN:DOMAIN,CUSTOMER_HOSTING_DOMAIN_READY:DOMAIN};
 const h=await edgeHarness({slug:'website-customer-access/index.ts',admin:postgrestFixture(db),env,bucket:{},users:{admin:{id:ADMIN},stranger:{id:STRANGER}}});
 const send=async(body,token='admin')=>{const r=await h.handler(new Request('https://fixture.supabase.co/functions/v1/website-customer-access',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()};};
 async function order(n,plan='one',update='none'){
  const code=({one:'P',semi:'S',full:'F'}[plan])+n,amount={one:15000,semi:22000,full:30000}[plan];
  await q('insert into public.website_orders(order_code,plan,update_plan,amount_from,line_user_id) values($1,$2,$3,$4,$5)',[code,plan,update,amount,'U_FAKE_'+n]);
  const u=await rpc('reserve_url',[ADMIN,code,DOMAIN]);return {code,url:u.public_url,amount};
 }
 async function draft(o){const made=makeCommercialQuote({policy:commercialPolicy(),order:{order_code:o.code,plan:'one',amount_from:15000},request:quoteRequest(quoteInput()),publicUrl:o.url,bankMessage:'架空の銀行・支店・口座番号・名義の試験データ',quoteId:crypto.randomUUID()});return{...made,fingerprint:await hash(made.message)};}
 const claim=(o,d)=>rpc('claim_quote',[ADMIN,o.code,JSON.stringify(d.snapshot),d.message,d.fingerprint]);
 await t.test('anonymous callers, non-admins and browser approval flags cannot send or attest a contract',async()=>{
  const o=await order('9100');
  assert.equal((await send({action:'admin_send_final_quote',order_code:o.code,...quoteInput(),approved:true},'')).status,401);
  assert.equal((await send({action:'admin_send_final_quote',order_code:o.code,...quoteInput()},'stranger')).status,403);
  assert.equal((await send({action:'admin_send_final_quote',order_code:o.code,...quoteInput(),policy:commercialPolicy()})).status,409);
  assert.equal(h.messages.length,0);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc('accept_contract',[ADMIN,o.code,HASH,'架空の同意返信日時']),/permission denied/);}
  await db.exec('set role service_role');await savePolicy(commercialPolicy());
 });
 for(const[i,plan]of ['one','semi','full'].entries())await t.test(plan+': quotation -> explicit operator-attested customer acceptance -> atomic paid activation',async()=>{
  const o=await order(String(9110+i),plan);
  const before=await send({action:'admin_activate_order',order_code:o.code});assert.equal(before.status,409);
  const sent=await send({action:'admin_send_final_quote',order_code:o.code,...quoteInput(o.amount)});assert.equal(sent.status,200,JSON.stringify(sent.body));
  assert.equal(sent.body.final_amount,o.amount);
  assert.equal((await send({action:'admin_activate_order',order_code:o.code})).status,409);
  const detail=await send({action:'admin_contract_detail',order_code:o.code});assert.equal(detail.body.contract.state,'sent');
  assert.match(detail.body.contract.message,/キャンセル・返金/);assert.match(detail.body.contract.message,/解約・引き渡し/);
  const fingerprint=detail.body.contract.fingerprint;
  assert.equal((await send({action:'admin_record_contract_acceptance',order_code:o.code,quote_fingerprint:HASH,acceptance_reference:'架空の顧客の同意返信日時'})).status,409);
  assert.equal((await send({action:'admin_record_contract_acceptance',order_code:o.code,quote_fingerprint:fingerprint,acceptance_reference:'架空の顧客の同意返信日時'})).status,200);
  const active=await send({action:'admin_activate_order',order_code:o.code});assert.equal(active.status,200,JSON.stringify(active.body));
  assert.equal((await q('select selections from public.website_orders where order_code=$1',[o.code])).rows[0].selections.commercial_quote.acceptance_method,'operator_attested_LINE_reply');
 });
 await t.test('unknown send reuses frozen recipient, body and LINE key despite later bank/policy edits',async()=>{
  const o=await order('9120'),d=await draft(o),a=await claim(o,d);
  await savePolicy({...commercialPolicy(),version:'later-terms',hosting:{...commercialPolicy().hosting,renewal_fee_jpy:12000}});
  await q("update public.website_settings set value='{\"message\":\"後から変更した別の口座\"}' where key='bank_transfer'");
  const b=await claim(o,d);assert.equal(b.retry_key,a.retry_key);assert.equal(b.message,a.message);assert.equal(b.recipient,a.recipient);
  await assert.rejects(claim(o,{...d,message:d.message+'変更',fingerprint:await hash(d.message+'変更')}),/immutable/);
  await q('update public.website_orders set line_user_id=$1 where order_code=$2',['U_CHANGED',o.code]);await assert.rejects(claim(o,d),/immutable/);
  await savePolicy(commercialPolicy());
 });
 await t.test('a sent/accepted quote cannot be silently amended, and acceptance cannot be replaced',async()=>{
  const o=await order('9121'),d=await draft(o);await claim(o,d);await rpc('complete_quote',[ADMIN,o.code,d.fingerprint]);
  await rpc('accept_contract',[ADMIN,o.code,d.fingerprint,'架空同意返信・11月13日18時30分']);
  assert.equal((await rpc('accept_contract',[ADMIN,o.code,d.fingerprint,'架空同意返信・11月13日18時30分'])).already_recorded,true);
  await assert.rejects(rpc('accept_contract',[ADMIN,o.code,d.fingerprint,'別の返信へ勝手に書き換え']),/cannot be replaced/);
  await assert.rejects(claim(o,d),/unsent/);
  await assert.rejects(q("update public.website_orders set selections=jsonb_set(selections,'{commercial_quote,message}','\"改ざん\"') where order_code=$1",[o.code]),/immutable/);
  await assert.rejects(q("update public.website_orders set selections=jsonb_set(selections,'{final_quote_amount}','1') where order_code=$1",[o.code]),/immutable/);
 });
 await t.test('hash tampering, mismatched totals and unapproved server policy are rejected by SQL too',async()=>{
  const o=await order('9122'),d=await draft(o);
  await assert.rejects(claim(o,{...d,fingerprint:HASH}),/fingerprint/);
  await assert.rejects(claim(o,{...d,snapshot:{...d.snapshot,initial_total_jpy:1}}),/approved fees/);
  await savePolicy({...commercialPolicy(),enabled:false});await assert.rejects(claim(o,d),/approve/);await savePolicy(commercialPolicy());
 });
 await t.test('direct paid activation and expired unknown deliveries cannot bypass review',async()=>{
  const o=await order('9123'),d=await draft(o);
  // Insert a synthetic already-expired initial ledger; real ledgers never allow timestamp rewrites.
  await q("update public.website_orders set selections=jsonb_build_object('commercial_quote',$1::jsonb) where order_code=$2",[JSON.stringify({state:'sending',snapshot:d.snapshot,message:d.message,fingerprint:d.fingerprint,recipient:'U_FAKE_9123',retry_key:crypto.randomUUID(),started_at:new Date(Date.now()-24*3600000).toISOString(),created_by:ADMIN}),o.code]);
  await assert.rejects(q("update public.website_orders set status='site_created' where order_code=$1",[o.code]),/acceptance|accepted|contract/i);
  await assert.rejects(claim(o,d),/retry window expired/);
 });
 await t.test('two independent connections cannot reserve different contracts for one order',{skip:!db.independent},async()=>{
  const o=await order('9124'),a=await draft(o),b=await draft(o),second=await db.independent();
  try{
   await q('begin');const first=await claim(o,a);const pending=second.query('select public.website_hosting_claim_quote($1,$2,$3,$4,$5)',[ADMIN,o.code,JSON.stringify(b.snapshot),b.message,b.fingerprint]);
   const rejected=assert.rejects(pending,/immutable/);await q('commit');await rejected;
   assert.equal((await claim(o,a)).retry_key,first.retry_key);
  }finally{await second.end();}
 });
 assert.equal(h.requests.length,0,'No LINE, customer, bank, GitHub or paid AI request leaves the fixture');
});
