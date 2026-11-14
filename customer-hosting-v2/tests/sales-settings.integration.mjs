import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resourceDatabase} from './helpers/resource-db.mjs';
import {edgeHarness,postgrestFixture} from './helpers/edge-harness.mjs';
const actor='11111111-1111-4111-8111-111111111111';
test('actual sales setup HTTP endpoints protect private details and never send or activate orders',async t=>{
 const db=await resourceDatabase();t.after(()=>db.close());await db.exec(await readFile(new URL('./fixtures/hosting-base.sql',import.meta.url),'utf8'));await db.exec('set role service_role');
 const h=await edgeHarness({slug:'website-sales-setup/index.ts',admin:postgrestFixture(db),users:{admin:{id:actor},stranger:{id:'33333333-3333-4333-8333-333333333333'}}});
 const send=async(body,token='admin',origin='https://sho-web-support.netlify.app')=>{const r=await h.handler(new Request('https://fixture.supabase.co/functions/v1/website-sales-setup',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,origin},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()};};
 assert.equal((await send({action:'admin_get_sales_settings'},'')).status,401);
 assert.equal((await send({action:'admin_get_sales_settings'},'stranger')).status,403);
 assert.equal((await send({action:'admin_get_sales_settings'},'admin','https://evil.invalid')).status,403);
 for(const action of ['admin_activate_order','admin_send_final_quote','admin_publish_site'])assert.equal((await send({action})).status,403);
 const draft=await send({action:'admin_save_sales_settings',enable:false,seller:{legal_name:'下書きのみ'}});assert.equal(draft.status,200);assert.equal(draft.body.enabled,false);
 assert.equal((await send({action:'admin_commercial_policy_status'})).body.ready,false);
 const payload={action:'admin_save_sales_settings',enable:true,seller:{legal_name:'単体試験事業者',address:'検証県検証市検証区1-2-3',phone:'000-1234-5678',contact:'qa@example.test'},bank_message:'単体試験銀行／支店／普通1234567／試験名義',backup_reference:'単体試験のみ・復元確認記録20261113',confirm_terms:true,confirm_disclosure:true,confirm_backup:true};
 assert.notEqual((await send({...payload,confirm_backup:false})).status,200);
 const saved=await send(payload);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.enabled,true);
 const read=await send({action:'admin_get_sales_settings'});assert.equal(read.body.seller.address,payload.seller.address);assert.equal(read.body.policy.approved_by,actor);assert.equal(read.body.policy.hosting.renewal_fee_jpy,6000);
 const status=await send({action:'admin_commercial_policy_status'});assert.equal(status.body.ready,false);assert.equal(status.body.policy_ready,true);assert.match(status.body.reason,/本番切り替え/);
 const configured={WEBSITE_CUSTOMER_HOSTING:'cloudflare-r2',CUSTOMER_BASE_DOMAIN:'fixture.invalid',CUSTOMER_HOSTING_DOMAIN_READY:'fixture.invalid',CUSTOMER_R2_ACCOUNT_ID:'fixture',CUSTOMER_R2_BUCKET:'fixture',CUSTOMER_R2_ACCESS_KEY_ID:'fixture',CUSTOMER_R2_SECRET_ACCESS_KEY:'fixture'};
 for(const [env,expected,reason] of [[{WEBSITE_CUSTOMER_HOSTING:'cloudflare-r2'},false,/正式URL/],[{...configured,CUSTOMER_R2_SECRET_ACCESS_KEY:''},false,/R2/],[configured,true,null]]){
  const setup=await edgeHarness({slug:'website-sales-setup/index.ts',admin:postgrestFixture(db),users:{admin:{id:actor}},env});
  const response=await setup.handler(new Request('https://fixture.supabase.co/functions/v1/website-sales-setup',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer admin'},body:JSON.stringify({action:'admin_commercial_policy_status'})}));
  const state=await response.json();assert.equal(state.ready,expected);if(reason)assert.match(state.reason,reason);
  assert.equal(setup.messages.length,0);assert.equal(setup.requests.length,0);
 }
 for(const slug of ['website-customer-access/index.ts','website-api/index.ts']){
  const disabled=await edgeHarness({slug,admin:postgrestFixture(db),users:{admin:{id:actor}}});
  for(const action of ['admin_activate_order','create_site','admin_publish_site','admin_send_final_quote']){
   const response=await disabled.handler(new Request('https://fixture.supabase.co/functions/v1/'+slug.split('/')[0],{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer admin'},body:JSON.stringify({action,site_id:'9100',order_code:'P9100'})}));
   assert.equal(response.status,409,slug+' must block legacy mutation '+action);
  }
  assert.equal(disabled.messages.length,0);assert.equal(disabled.requests.length,0);
 }
 assert.equal((await db.query('select count(*) as n from public.website_orders')).rows[0].n,0);
 assert.equal(h.requests.length,0);assert.equal(h.messages.length,0);assert.equal(h.background.length,0);
});
test('public order endpoint rejects missing or outdated hosting acknowledgement before DB or notification',async()=>{
 const h=await edgeHarness({slug:'website-order-api/index.ts',admin:{from(){throw Error('No database operation expected');}}});
 for(const extra of [{},{hosting_offer_version:'stale',hosting_offer_acknowledged:true},{hosting_offer_version:'hosting-20261113',hosting_offer_acknowledged:false}]){
  const r=await h.handler(new Request('https://fixture.supabase.co/functions/v1/website-order-api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plan:'one',update_plan:'none',...extra})}));assert.equal(r.status,400);
 }
 assert.equal(h.requests.length,0);assert.equal(h.messages.length,0);
});
