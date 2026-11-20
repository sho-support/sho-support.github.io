import { HOSTING_OFFER } from '../../supabase/functions/_shared/hosting-offer.mjs';
import { renewalWindow } from './policy.mjs';

export const cardRenewalTerms = Object.freeze({
  version: 'card-renewal-20261120',
  feeJpy: HOSTING_OFFER.renewal_fee_jpy,
  months: HOSTING_OFFER.renewal_months,
});

export const cardConfirmationDays = 3;
const day = 24 * 60 * 60 * 1000;

export function cardRenewalWindow(term, now) {
  const current = renewalWindow(term, now);
  const status = term.card?.status ?? 'unregistered';
  const collectingByCard = status === 'scheduled' || status === 'failed';
  const awaitingCardPayment = collectingByCard && now >= current.paidUntil;
  const holdDays = status === 'failed' ? 1 : cardConfirmationDays;
  const holdForConfirmation = awaitingCardPayment && now < current.paidUntil + holdDays * day;
  return {
    status,
    chargeAt: current.paidUntil,
    canEnroll: current.canChoose && !collectingByCard,
    canStop: status === 'scheduled' && now < current.paidUntil,
    canChooseBank: current.canChoose && !collectingByCard,
    awaitingCardPayment,
    holdForConfirmation,
    needsConfirmationReview: status === 'scheduled' && awaitingCardPayment && !holdForConfirmation,
  };
}

export function enrollCardRenewal(term, { acceptedVersion, subscriptionId }, now) {
  if (acceptedVersion !== cardRenewalTerms.version) throw new Error('Current auto-renewal terms need consent');
  if (!cardRenewalWindow(term, now).canEnroll) throw new Error('Card enrollment is unavailable');
  if (typeof subscriptionId !== 'string' || !subscriptionId) throw new TypeError('A related subscription is required');
  return {
    ...term,
    choice: 'continue',
    card: { status: 'scheduled', subscriptionId, acceptedVersion, acceptedAt: now },
  };
}

export function stopCardRenewal(term, now) {
  if (!cardRenewalWindow(term, now).canStop) throw new Error('Stopping the upcoming card renewal is unavailable');
  return { ...term, choice: null, card: { ...term.card, status: 'stopped' } };
}

export function recordCardFailure(term, { subscriptionId, periodStart }, now) {
  const { status, chargeAt } = cardRenewalWindow(term, now);
  if (status !== 'scheduled' || now < chargeAt || periodStart !== chargeAt || term.card.subscriptionId !== subscriptionId) return term;
  return { ...term, card: { ...term.card, status: 'failed' } };
}

// This sample accepts a normalized result. The real backend must verify it with the payment processor first.
export function applyCardReceipt(term, receipt, now) {
  const { status, chargeAt } = cardRenewalWindow(term, now);
  if ((status !== 'scheduled' && status !== 'failed') || receipt.subscriptionId !== term.card.subscriptionId) return term;
  if (typeof receipt.invoiceId !== 'string' || !receipt.invoiceId || receipt.invoiceId === term.card.lastInvoiceId) return term;
  if (receipt.payment !== 'settled_card' || receipt.amount !== cardRenewalTerms.feeJpy || receipt.currency !== 'jpy') return term;
  if (now < chargeAt || receipt.periodStart !== chargeAt || receipt.periodEnd !== term.expectedRenewalEnd) return term;
  if (!Number.isSafeInteger(receipt.periodEnd) || receipt.periodEnd <= chargeAt || now >= receipt.periodEnd) return term;
  return {
    ...term,
    confirmedUntil: receipt.periodEnd,
    card: { ...term.card, status: 'scheduled', lastInvoiceId: receipt.invoiceId },
  };
}
