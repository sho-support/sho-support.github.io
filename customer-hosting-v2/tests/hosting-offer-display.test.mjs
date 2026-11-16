import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HOSTING_OFFER,matchesHostingOffer} from '../../supabase/functions/_shared/hosting-offer.mjs';
import {makeSalesSettings} from '../../supabase/functions/_shared/commercial-setup.mjs';
test('nine prospective sales pages disclose annual hosting separately without JavaScript',async()=>{
 for(const name of ['website-support','website-create','band-homepage','website-order','website-order-confirm','website-faq','website-legal','website-terms','website-payment']){
  const html=await readFile(new URL('../../'+name+'.html',import.meta.url),'utf8');
  assert.ok(html.includes('data-hosting-offer="'+HOSTING_OFFER.version+'"'),name);
  assert.ok(html.includes('6,000円／年（税込・年払い）'),name);
  assert.ok(html.includes('自動更新・自動課金はありません'),name);
 }
});
test('draft seller settings cannot claim approval or accept browser price overrides',()=>{
 const r=makeSalesSettings({enable:false,seller:{legal_name:'下書き'},hosting:{renewal_fee_jpy:1},approved:true},'owner');
 assert.equal(r.policy.enabled,false);assert.equal(r.policy.approved_by,null);assert.ok(matchesHostingOffer(r.policy.hosting));
 assert.equal(r.backup.attested,false);assert.equal(r.policy.terms.provider,'__UNSET__');
});
test('formal policy activation needs actual fields and explicit operator attestations',()=>{
 const body={enable:true,seller:{legal_name:'単体試験事業者',address:'検証県検証市検証区1-2-3',phone:'000-1234-5678',contact:'qa@example.test'},bank_message:'単体試験銀行／支店／普通1234567／試験名義',backup_reference:'単体試験のみの復元記録20261113',confirm_terms:true,confirm_disclosure:true,confirm_backup:true};
 const r=makeSalesSettings(body,'11111111-1111-4111-8111-111111111111');
 assert.equal(r.policy.enabled,true);assert.ok(r.policy.terms.provider.includes(body.seller.address));
 for(const changed of [{seller:{...body.seller,phone:''}},{bank_message:''},{backup_reference:''},{confirm_backup:false},{confirm_terms:false},{confirm_disclosure:false}]){
  assert.throws(()=>makeSalesSettings({...body,...changed},'owner'));
 }
});
