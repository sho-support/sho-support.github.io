// Public prices agreed for the first sales. Never contains seller details or credentials.
export const HOSTING_OFFER=Object.freeze({version:'hosting-20261113',initial_months:12,initial_fee_jpy:0,renewal_months:12,renewal_fee_jpy:6000,renewal:'opt_in',notice_days:30});
export function matchesHostingOffer(hosting){return hosting&&Object.entries(HOSTING_OFFER).filter(([k])=>k!=='version').every(([k,v])=>hosting[k]===v);}

const restorationFeeJpy = 3000;
export const HOSTING_RESTORATION = Object.freeze({
  version: 'restoration-20261120',
  request_days: 90,
  handover_days: 30,
  restoration_fee_jpy: restorationFeeJpy,
  hosting_fee_jpy: HOSTING_OFFER.renewal_fee_jpy,
  hosting_months: HOSTING_OFFER.renewal_months,
  total_jpy: restorationFeeJpy + HOSTING_OFFER.renewal_fee_jpy,
});

export function restorationPrice(offer = HOSTING_RESTORATION) {
  const yen = (value) => value.toLocaleString('ja-JP') + '円';
  return `公開維持費 ${yen(offer.hosting_fee_jpy)}（${offer.hosting_months}か月）＋復元作業料 ${yen(offer.restoration_fee_jpy)}＝合計 ${yen(offer.total_jpy)}（税込）`;
}
