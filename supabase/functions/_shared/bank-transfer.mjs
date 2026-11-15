// Test-only instructions never become the production payment destination.
export function isTestBankMessage(value){
  return /(?:テスト銀行|テスト支店|テスト専用|テスト用|振込禁止|振込不可|仮の口座|(?:^|\D)0{7}(?:\D|$))/.test(String(value||''));
}
export function bankForSettings(production,test){
  const actual=String(production?.message||'').trim(),fixture=String(test?.message||'').trim();
  return {bank_message:actual||fixture,bank_is_test:actual?isTestBankMessage(actual):!!fixture};
}
