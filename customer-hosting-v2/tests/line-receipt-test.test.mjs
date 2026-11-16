import test from 'node:test';
import assert from 'node:assert/strict';
import {blocksLineReceiptMutation,lineReceiptTestReply} from '../../supabase/functions/_shared/line-receipt-test.mjs';
test('receipt fixture blocks its five commercial entry points while preserving read-only inspection',()=>{
 for(const action of ['admin_activate_order','admin_send_final_quote','admin_resend_intake','admin_resolve_free_url','admin_record_contract_acceptance'])assert.equal(blocksLineReceiptMutation(action,'9000001001'),true);
 for(const action of ['admin_list_orders','admin_bank_settings','admin_contract_detail'])assert.equal(blocksLineReceiptMutation(action,'9000001001'),false);
 assert.equal(blocksLineReceiptMutation('admin_activate_order','1001'),false);
});
test('test-bank details require the explicit fixture allowlist and cannot be used for an ordinary order',()=>{
 const bank={message:'テスト銀行0000000',order_codes:['9000001001']};
 assert.match(lineReceiptTestReply('9000001001',bank),/テスト用・架空口座/);
 assert.ok(!lineReceiptTestReply('9000001001',{...bank,order_codes:[]}).includes('0000000'));
 assert.throws(()=>lineReceiptTestReply('1001',bank),/reserved/);
});
