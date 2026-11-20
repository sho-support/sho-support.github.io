import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommercialPolicy,quoteRequest,makeCommercialQuote,sameQuoteRequest} from '../../supabase/functions/_shared/commercial-policy.mjs';
import {HOSTING_RESTORATION} from '../../supabase/functions/_shared/hosting-offer.mjs';
import {commercialPolicy,quoteInput} from './helpers/commercial-fixture.mjs';
const make=(overrides={})=>makeCommercialQuote({policy:commercialPolicy(),order:{order_code:'P8100',plan:'one',amount_from:15000,update_plan:'none'},request:quoteRequest(quoteInput()),
 publicUrl:'https://s8100.customer-sites.example/',bankMessage:'銀行名・支店名・口座番号・名義の架空試験データ',quoteId:crypto.randomUUID(),...overrides});
test('test bank labels and an all-zero account can never enter a formal quote',()=>{
 for(const bankMessage of ['【テスト専用・振込禁止】テスト銀行 テスト支店 普通0000000 名義テスト用','銀行名・支店名・普通 0000000・口座名義'])assert.throws(()=>make({bankMessage}),/テスト用/);
});
test('unapproved, malformed, future-approved and automatic-renewal policies cannot produce an offer',()=>{
 for(const change of [()=>null,p=>({...p,enabled:false}),p=>({...p,approved_at:'2099-01-01'}),p=>({...p,approved_by:'browser-approved'}),p=>({...p,hosting:{...p.hosting,renewal:'auto'}}),p=>({...p,terms:{...p.terms,provider:'__UNSET__'}})])assert.throws(()=>validateCommercialPolicy(change(commercialPolicy())));
});
test('three approved plans preserve prices, the 30-day adjustment and only eligible 3-month campaigns',()=>{
 for(const [plan,amount]of Object.entries({one:15000,semi:22000,full:30000})){
  const result=make({order:{order_code:'P8100',plan,amount_from:amount},request:quoteRequest(quoteInput(amount))});
  assert.equal(result.total,amount);assert.match(result.message,/公開後30日間/);assert.match(result.message,/自動更新・自動課金なし/);
  assert.equal(result.message.includes('内容更新キャンペーン：公開日から3か月'),plan!=='one');
 }
});
test('hosting and selected content updates are itemized and cannot silently disappear from the total',()=>{
 const policy=commercialPolicy();
 const r=make({policy,order:{order_code:'P8100',plan:'one',amount_from:15000,update_plan:'unlimited'}});
 assert.equal(r.total,22000);assert.equal(r.snapshot.production_amount_jpy,15000);assert.equal(r.snapshot.update_initial_fee_jpy,7000);assert.match(r.message,/22,000円/);
});
test('published annual hosting fees cannot drift from the approved public offer',()=>{
 for(const h of [{initial_fee_jpy:500},{renewal_fee_jpy:12000},{initial_months:1},{renewal_months:1}])assert.throws(()=>make({policy:{...commercialPolicy(),hosting:{...commercialPolicy().hosting,...h}}}),/公開ページ/);
});
test('fixed restoration prices are disclosed and frozen, without charging the initial order or rewriting legacy terms',()=>{
 const policy={...commercialPolicy(),restoration:{...HOSTING_RESTORATION}};
 const quote=make({policy});
 assert.equal(quote.total,15000);
 assert.match(quote.message,/満了後90日以内に申込み/);
 assert.match(quote.message,/公開維持費 6,000円（12か月）＋復元作業料 3,000円＝合計 9,000円（税込）/);
 assert.match(quote.message,/公開維持は再公開日から12か月/);
 assert.deepEqual(quote.snapshot.policy.restoration,HOSTING_RESTORATION);
 assert.throws(()=>make({policy:{...policy,restoration:{...policy.restoration,total_jpy:6000}}}),/復元料金/);
 assert.doesNotMatch(make().message,/満了後の標準復元/);
});
test('draft/body flags, changed requests and vendor/auth-parent URLs never create an approved formal URL',()=>{
 assert.throws(()=>make({policy:{...commercialPolicy(),enabled:false,approved:true}}));
 const a=quoteRequest(quoteInput());assert.ok(sameQuoteRequest(a,structuredClone(a)));assert.ok(!sameQuoteRequest(a,{...a,production_amount:16000}));
 for(const url of ['https://s8100.sho-support.com/','https://s8100.github.io/','https://x.workers.dev/','https://x.netlify.app/','https://customer-sites.example/?key=secret','http://s8100.customer-sites.example/'])assert.throws(()=>make({publicUrl:url}));
});
test('payment deadlines, plan floors, missing delivery terms and oversized messages are rejected',()=>{
 for(const change of [{final_amount:14999},{payment_deadline:'2020-01-01'},{payment_deadline:'2026-02-30'},{delivery_terms:''}])assert.throws(()=>make({request:quoteRequest({...quoteInput(),...change})}));
 const policy=commercialPolicy();for(const k of Object.keys(policy.terms))policy.terms[k]='長'.repeat(k==='provider'?600:450);
 assert.throws(()=>make({policy,bankMessage:'口'.repeat(800),request:quoteRequest({...quoteInput(),quote_note:'補'.repeat(500)})}),/安全上限/);
});
