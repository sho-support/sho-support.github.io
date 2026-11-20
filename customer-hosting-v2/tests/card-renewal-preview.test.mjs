import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCardReceipt, cardRenewalTerms, cardRenewalWindow, enrollCardRenewal,
  recordCardFailure, stopCardRenewal,
} from '../renewal-preview/card-renewal.mjs';
import { renewalWindow } from '../renewal-preview/policy.mjs';

const day = 86400000;
const expiresAt = Date.parse('2027-11-20T18:00:00+09:00');
const expectedRenewalEnd = Date.parse('2028-11-20T18:00:00+09:00');
const term = { expiresAt, expectedRenewalEnd };
const consent = { acceptedVersion: cardRenewalTerms.version, subscriptionId: 'sub_sample' };
const receipt = {
  subscriptionId: consent.subscriptionId,
  invoiceId: 'inv_sample',
  payment: 'settled_card',
  currency: 'jpy',
  amount: 6000,
  periodStart: expiresAt,
  periodEnd: expectedRenewalEnd,
};

test('card enrollment requires explicit consent during the renewal window and preserves the paid term', () => {
  const now = expiresAt - 14 * day;
  assert.equal(cardRenewalWindow(term, now).status, 'unregistered');
  assert.equal(cardRenewalWindow(term, now).canChooseBank, true);
  assert.throws(() => enrollCardRenewal(term, { ...consent, acceptedVersion: '' }, now), /consent/);
  assert.throws(() => enrollCardRenewal(term, consent, expiresAt - day), /unavailable/);
  const enrolled = enrollCardRenewal(term, consent, now);
  assert.equal(cardRenewalWindow(enrolled, now).chargeAt, expiresAt);
  assert.equal(cardRenewalWindow(enrolled, now).canChooseBank, false);
  assert.equal(renewalWindow(enrolled, now).paymentConfirmed, false);
  assert.throws(() => enrollCardRenewal(enrolled, consent, now), /unavailable/);
});

test('stopping the scheduled renewal in the last day preserves existing publication until expiry', () => {
  const enrolled = enrollCardRenewal(term, consent, expiresAt - 14 * day);
  const stopped = stopCardRenewal(enrolled, expiresAt - 1);
  assert.equal(cardRenewalWindow(stopped, expiresAt).holdForConfirmation, false);
  assert.equal(cardRenewalWindow(stopped, expiresAt + 3 * day).needsConfirmationReview, false);
  assert.equal(renewalWindow(stopped, expiresAt - 1).termAllowsPublication, true);
  assert.equal(renewalWindow(stopped, expiresAt).termAllowsPublication, false);
  assert.equal(applyCardReceipt(stopped, receipt, expiresAt), stopped);
  assert.throws(() => stopCardRenewal(enrolled, expiresAt), /unavailable/);
});

test('an unresolved card payment holds publication for three days and then needs review', () => {
  const enrolled = enrollCardRenewal(term, consent, expiresAt - 14 * day);
  assert.equal(cardRenewalWindow(enrolled, expiresAt - 1).awaitingCardPayment, false);
  assert.equal(cardRenewalWindow(enrolled, expiresAt).holdForConfirmation, true);
  assert.equal(cardRenewalWindow(enrolled, expiresAt + day).holdForConfirmation, true);
  assert.equal(cardRenewalWindow(enrolled, expiresAt + 3 * day - 1).holdForConfirmation, true);
  const overdue = cardRenewalWindow(enrolled, expiresAt + 3 * day);
  assert.equal(overdue.holdForConfirmation, false);
  assert.equal(overdue.awaitingCardPayment, true);
  assert.equal(overdue.needsConfirmationReview, true);
  assert.equal(overdue.canChooseBank, false);
  assert.equal(renewalWindow(enrolled, expiresAt + 3 * day).paymentConfirmed, false);
  const paid = applyCardReceipt(enrolled, receipt, expiresAt + 3 * day);
  assert.equal(paid.confirmedUntil, expectedRenewalEnd);
  assert.equal(cardRenewalWindow(paid, expiresAt + 3 * day).needsConfirmationReview, false);
});

test('a known failure keeps the one-day grace and can still recover after a verified payment', () => {
  const enrolled = enrollCardRenewal(term, consent, expiresAt - 14 * day);
  const failure = { subscriptionId: consent.subscriptionId, periodStart: expiresAt };
  assert.equal(recordCardFailure(enrolled, { ...failure, subscriptionId: 'sub_other' }, expiresAt), enrolled);
  assert.equal(recordCardFailure(enrolled, { ...failure, periodStart: expiresAt - day }, expiresAt), enrolled);
  const failed = recordCardFailure(enrolled, failure, expiresAt);
  assert.equal(cardRenewalWindow(failed, expiresAt).status, 'failed');
  assert.equal(cardRenewalWindow(failed, expiresAt + day - 1).holdForConfirmation, true);
  assert.equal(cardRenewalWindow(failed, expiresAt + day).holdForConfirmation, false);
  assert.equal(cardRenewalWindow(failed, expiresAt + day).needsConfirmationReview, false);
  assert.equal(cardRenewalWindow(failed, expiresAt).canChooseBank, false);
  assert.equal(renewalWindow(failed, expiresAt).paymentConfirmed, false);
  assert.equal(applyCardReceipt(failed, receipt, expiresAt).confirmedUntil, expectedRenewalEnd);
  assert.equal(applyCardReceipt(failed, receipt, expiresAt + day).confirmedUntil, expectedRenewalEnd);
});

test('only the matching settled annual card payment can extend a term, and replay is harmless', () => {
  const enrolled = enrollCardRenewal(term, consent, expiresAt - 14 * day);
  for (const changes of [{ subscriptionId: 'sub_other' }, { invoiceId: '' }, { payment: 'out_of_band' },
    { amount: 0 }, { amount: 9000 }, { currency: 'usd' }, { periodStart: expiresAt - day },
    { periodEnd: expectedRenewalEnd + day }]) {
    assert.equal(applyCardReceipt(enrolled, { ...receipt, ...changes }, expiresAt), enrolled);
  }
  assert.equal(applyCardReceipt(enrolled, receipt, expiresAt - 1), enrolled);
  const renewed = applyCardReceipt(enrolled, receipt, expiresAt);
  assert.equal(renewed.confirmedUntil, expectedRenewalEnd);
  assert.equal(cardRenewalWindow(renewed, expiresAt).chargeAt, expectedRenewalEnd);
  assert.equal(recordCardFailure(renewed, { subscriptionId: consent.subscriptionId, periodStart: expiresAt }, expectedRenewalEnd), renewed);
  assert.equal(applyCardReceipt(renewed, receipt, expiresAt), renewed);
  assert.equal(applyCardReceipt(renewed, { ...receipt, invoiceId: 'inv_other' }, expiresAt), renewed);
  assert.equal(stopCardRenewal(renewed, expiresAt).confirmedUntil, expectedRenewalEnd);
});
