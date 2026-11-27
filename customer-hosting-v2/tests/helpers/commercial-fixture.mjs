export const COMMERCIAL_ADMIN='11111111-1111-4111-8111-111111111111';
export function commercialPolicy(){return {
 schema:1,enabled:true,version:'synthetic-terms-1',approved_by:COMMERCIAL_ADMIN,approved_at:'2026-11-01T00:00:00Z',
 hosting:{initial_months:12,initial_fee_jpy:0,renewal_months:12,renewal_fee_jpy:6000,renewal:'opt_in',notice_days:30},
 terms:{provider:'架空事業者／架空県テスト市／電話000-0000-0000／連絡先は試験用で実在しません。',
 hosting:'契約期間中の配信・HTTPSと標準URL管理。永久維持・完全無停止は保証しません。',
 cancellation:'入金前は無料。制作開始前は実費を除き返金、開始後は完了済み作業と外部実費を控除します。',
 handover:'満了前の申出により完成ファイルと素材を引き渡します。SHO所有サブドメインの所有権移転は含みません。',
 rights:'お客様素材の権利はお客様に帰属。第三者素材と共通部品は各ライセンスによります。',
 data:'制作に必要な情報を指定事業者へ委託し、法定保存が必要な記録を除き保存期間後に削除します。',
 backup:'暗号化した別保管先への定期保存と復元確認を行います。復旧時間と全損失ゼロは保証しません。',
 support:'公式LINEで受け付け、受付から2営業日以内に一次回答。夜間の常時監視は含みません。',
 update_billing:'初回適用期間は公開日から1か月。月8回は日本時間の暦月単位。継続時は事前に別途申込みと入金を確認します。'}
};}
export const quoteDeadline=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,10);
export const quoteInput=(amount=15000)=>({final_amount:amount,public_domain:'free',quote_note:'',delivery_terms:'1サイトを制作。入金と全素材の受領から14日以内に初回案を提示します。',payment_deadline:quoteDeadline()});
