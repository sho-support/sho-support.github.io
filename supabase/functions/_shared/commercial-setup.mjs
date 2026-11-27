import {HOSTING_OFFER} from './hosting-offer.mjs';
export const DEFAULT_TERMS=Object.freeze({
 hosting:'SHO管理の標準URL・HTTPS・静的サイト配信・公開版保管と障害時復旧対応。契約期間中はサーバー変更を理由にURLを変更しません。永久利用権や完全無停止は保証しません。',
 cancellation:'入金前は無料。入金後・制作開始前は振込手数料と外部実費を除き返金。開始後は完了作業相当額と外部実費を控除します。公開・納品後は契約不一致の修正を除き原則返金なし。法令上の権利を妨げません。',
 handover:'継続しない場合は満了前に公式LINEへ連絡。完成ファイルと素材・利用権・設定説明を引き渡します。SHOドメイン所有権の移転は含みません。接続代行は別見積り。満了後30日間は引き渡し確認用に保管します。',
 rights:'お客様提供素材の権利はお客様に帰属します。共通テンプレート・第三者素材は各利用権に従います。独占的著作権の一括移転やAI生成物への著作権発生は保証しません。',
 data:'制作・運営に必要な範囲で指定事業者へ処理を委託します。満了後30日の確認期間後、法令上必要な取引記録を除き順次削除します。バックアップは保持世代の期限で削除します。',
 backup:'完成ファイルを世代保管し、DB・素材を暗号化して別保管します。復元確認を含む運用を行います。完全無停止・復旧時間・データ損失ゼロは保証しません。',
 support:'公式LINEで受け付け、2営業日以内の一次回答を目標とします。24時間有人対応・復旧時間保証は含みません。内容更新・大幅変更は別料金です。',
 update_billing:'初回の内容更新料は公開日から1か月分。月8回は日本時間の暦月単位で繰越なし。継続時は事前に別途申込みと入金を確認し、自動継続・自動課金しません。'});
const clean=(x,min,max,label)=>{if(typeof x!=='string'||x.trim().length<min||x.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)||/(?:__UNSET__|架空|テスト用|example\.com|XXXX)/i.test(x))throw Error(label+'を実際の情報で入力してください。');return x.trim();};
export function makeSalesSettings(body,actor,now=new Date()){
 const enabled=body.enable===true,s=body.seller||{},bank=String(body.bank_message||'').trim(),reference=String(body.backup_reference||'').trim();
 if(bank.length>800||reference.length>240)throw Error('入力文字数が上限を超えています。');
 const seller={};for(const[k,max]of Object.entries({legal_name:100,address:240,phone:40,contact:180}))seller[k]=String(s[k]||'').trim().slice(0,max);
 const terms={...DEFAULT_TERMS};
 for(const k of Object.keys(DEFAULT_TERMS))if(typeof body.terms?.[k]==='string')terms[k]=body.terms[k].trim();
 let provider='__UNSET__';
 if(enabled){
  clean(seller.legal_name,2,100,'事業者氏名');clean(seller.address,8,240,'所在地');clean(seller.phone,8,40,'電話番号');clean(seller.contact,5,180,'問い合わせ先');
  if(!/^[+\d()\-\s]{8,40}$/.test(seller.phone))throw Error('電話番号の形式を確認してください。');
  clean(bank,15,800,'振込先');clean(reference,8,240,'別保管・復元確認の記録');
  if(body.confirm_terms!==true||body.confirm_disclosure!==true||body.confirm_backup!==true)throw Error('販売条件・事業者情報の開示・バックアップの実施確認が必要です。');
  for(const[k,v]of Object.entries(terms))clean(v,12,450,k);
  provider='事業者：'+seller.legal_name+'／所在地：'+seller.address+'／電話：'+seller.phone+'／問い合わせ：'+seller.contact+'。請求時は契約判断前に遅滞なく開示します。';
 }
 return {seller,bank,backup:{reference,attested:enabled,attested_by:enabled?actor:null,attested_at:enabled?now.toISOString():null},policy:{schema:1,enabled,version:HOSTING_OFFER.version+'-'+now.getTime(),approved_by:enabled?actor:null,approved_at:enabled?now.toISOString():null,hosting:Object.fromEntries(Object.entries(HOSTING_OFFER).filter(([k])=>k!=='version')),terms:{provider,...terms}}};
}
