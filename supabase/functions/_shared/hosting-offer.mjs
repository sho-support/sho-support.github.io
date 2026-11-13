// Public prices agreed for the first sales. Never contains seller details or credentials.
export const HOSTING_OFFER=Object.freeze({version:'hosting-20261113',initial_months:12,initial_fee_jpy:0,renewal_months:12,renewal_fee_jpy:6000,renewal:'opt_in',notice_days:30});
export function matchesHostingOffer(hosting){return hosting&&Object.entries(HOSTING_OFFER).filter(([k])=>k!=='version').every(([k,v])=>hosting[k]===v);}
