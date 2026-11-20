import { HOSTING_OFFER, HOSTING_RESTORATION } from '../../supabase/functions/_shared/hosting-offer.mjs';

const day = 24 * 60 * 60 * 1000;
const choices = ['continue', 'decline'];

export function renewalWindow({ expiresAt, choice = null, confirmedUntil = null }, now) {
  if (![expiresAt, now].every(Number.isSafeInteger)) throw new TypeError('Use absolute times in milliseconds');
  if (choice !== null && !choices.includes(choice)) throw new TypeError('Invalid renewal choice');
  if (confirmedUntil !== null && (!Number.isSafeInteger(confirmedUntil) || confirmedUntil <= expiresAt)) {
    throw new TypeError('A confirmed renewal must extend the current term');
  }

  const opensAt = expiresAt - HOSTING_OFFER.notice_days * day;
  const locksAt = expiresAt - day;
  const paidUntil = confirmedUntil ?? expiresAt;
  const termAllowsPublication = now < paidUntil;
  const handoverUntil = paidUntil + HOSTING_RESTORATION.handover_days * day;
  const restoreUntil = paidUntil + HOSTING_RESTORATION.request_days * day;
  return {
    expiresAt,
    opensAt,
    locksAt,
    paidUntil,
    choice,
    paymentConfirmed: confirmedUntil !== null,
    canChoose: confirmedUntil === null && now >= opensAt && now < locksAt,
    termAllowsPublication,
    handoverUntil,
    restoreUntil,
    canDownloadHandover: !termAllowsPublication && now < handoverUntil,
    canRequestRestore: !termAllowsPublication && now < restoreUntil,
  };
}

export function selectRenewal(term, choice, now) {
  if (!choices.includes(choice)) throw new TypeError('Invalid renewal choice');
  if (!renewalWindow(term, now).canChoose) throw new RangeError('The renewal choice is locked');
  return { ...term, choice };
}
