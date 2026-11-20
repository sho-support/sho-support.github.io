import test from 'node:test';
import assert from 'node:assert/strict';
import { renewalWindow, selectRenewal } from '../renewal-preview/policy.mjs';

const day = 86400000;
const expiresAt = Date.parse('2027-11-20T18:00:00+09:00');
const initial = { expiresAt };

test('the choices open 30 days before expiry and lock exactly 24 hours before expiry', () => {
  assert.equal(renewalWindow(initial, expiresAt - 30 * day - 1).canChoose, false);
  assert.equal(renewalWindow(initial, expiresAt - 30 * day).canChoose, true);
  const declined = selectRenewal(initial, 'decline', expiresAt - day - 1);
  assert.equal(declined.choice, 'decline');
  assert.equal(selectRenewal(declined, 'continue', expiresAt - day - 1).choice, 'continue');
  assert.throws(() => selectRenewal(declined, 'continue', expiresAt - day), /locked/);
});

test('declining or leaving the choice blank preserves the remainder of the current term', () => {
  for (const choice of ['decline', null]) {
    const term = { expiresAt, choice };
    assert.equal(renewalWindow(term, expiresAt - day).termAllowsPublication, true);
    assert.equal(renewalWindow(term, expiresAt - 1).termAllowsPublication, true);
    assert.equal(renewalWindow(term, expiresAt).termAllowsPublication, false);
  }
});

test('a renewal wish does not extend the term without confirmed payment', () => {
  const requested = selectRenewal(initial, 'continue', expiresAt - 7 * day);
  assert.equal(renewalWindow(requested, expiresAt).paymentConfirmed, false);
  assert.equal(renewalWindow(requested, expiresAt).termAllowsPublication, false);
  const confirmedUntil = Date.parse('2028-11-20T18:00:00+09:00');
  const paid = { ...requested, confirmedUntil };
  assert.equal(renewalWindow(paid, expiresAt - 7 * day).canChoose, false);
  assert.equal(renewalWindow(paid, expiresAt).termAllowsPublication, true);
  assert.equal(renewalWindow(paid, confirmedUntil).termAllowsPublication, false);
  assert.equal(renewalWindow(paid, confirmedUntil).restoreUntil, confirmedUntil + 90 * day);
});

test('handover ends at 30 days and restoration requests end at 90 days', () => {
  assert.equal(renewalWindow(initial, expiresAt - 1).canDownloadHandover, false);
  assert.equal(renewalWindow(initial, expiresAt).canDownloadHandover, true);
  assert.equal(renewalWindow(initial, expiresAt + 30 * day).canDownloadHandover, false);
  assert.equal(renewalWindow(initial, expiresAt + 30 * day).canRequestRestore, true);
  assert.equal(renewalWindow(initial, expiresAt + 90 * day - 1).canRequestRestore, true);
  assert.equal(renewalWindow(initial, expiresAt + 90 * day).canRequestRestore, false);
});

test('invalid timestamps, choices and payment extensions are rejected', () => {
  assert.throws(() => renewalWindow({ expiresAt: '2027-11-20' }, expiresAt), /absolute times/);
  assert.throws(() => selectRenewal(initial, 'other', expiresAt - 7 * day), /Invalid renewal choice/);
  assert.throws(() => renewalWindow({ expiresAt, confirmedUntil: expiresAt }, expiresAt), /extend the current term/);
});
