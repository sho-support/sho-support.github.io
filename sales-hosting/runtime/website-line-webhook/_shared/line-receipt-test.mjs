// Reserved for the administrator's LINE receipt check, never a commercial order.
export const LINE_RECEIPT_TEST_ORDER_CODE='9000001001';
export const LINE_RECEIPT_TEST_ERROR=Object.freeze({
 error:'この注文はLINE受付の接続テスト専用です。正式見積り・入金確認・制作開始には使用できません。',
 code:'line_receipt_test_only'
});
export const isLineReceiptTestCode=value=>String(value??'').trim().toUpperCase()===LINE_RECEIPT_TEST_ORDER_CODE;
const mutations=new Set(['admin_activate_order','admin_send_final_quote','admin_resend_intake','admin_resolve_free_url','admin_record_contract_acceptance']);
export const blocksLineReceiptMutation=(action,code)=>isLineReceiptTestCode(code)&&mutations.has(action);

export function lineReceiptTestReply(code,setting){
 if(!isLineReceiptTestCode(code))throw Error('Only the reserved LINE receipt fixture is supported');
 const message=Array.isArray(setting?.order_codes)&&setting.order_codes.includes(LINE_RECEIPT_TEST_ORDER_CODE)
  ?String(setting?.message||'').trim():'';
 return '【HP販売・接続テスト専用】\n注文ID: '+LINE_RECEIPT_TEST_ORDER_CODE+
  '\nLINE連携の確認専用です。実際の注文・契約・請求・制作・公開は発生しません。'+
  (message?'\n\n【振込先（テスト用・架空口座）】\n'+message:'\n\nテスト用口座の表示は未設定です。')+
  '\n\n実際に振り込まないでください。確認後は管理者の接続・受入テスト画面を再読み込みしてください。';
}
