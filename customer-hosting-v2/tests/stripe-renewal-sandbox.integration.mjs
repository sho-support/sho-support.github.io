import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { edgeHarness, postgrestFixture } from './helpers/edge-harness.mjs';
import { resourceDatabase } from './helpers/resource-db.mjs';

const slug = 'website-stripe-renewal-sandbox/index.ts';
const siteId = '9100';
const noticeKey = `hosting_card_renewal_notice:${siteId}`;
const periodStart = Date.parse('2027-05-01T09:00:00Z') / 1000;
const periodEnd = Date.parse('2028-05-01T09:00:00Z') / 1000;
const owner = '22222222-2222-4222-8222-222222222222';
const viewer = '33333333-3333-4333-8333-333333333333';
const signingSecret = 'whsec_fixture_not_a_real_secret';
const env = {
  SUPABASE_URL: 'https://hp-fixture.supabase.co', WEBSITE_STRIPE_SANDBOX_SUPABASE_URL: 'https://hp-fixture.supabase.co',
  WEBSITE_STRIPE_SANDBOX_KEY: 'rk_test_fixture_not_a_real_key', WEBSITE_STRIPE_SANDBOX_SIGNING_SECRET: signingSecret,
  WEBSITE_STRIPE_SANDBOX_PRICE_ID: 'price_fixture_annual',
};

const initial = {
  mode: 'stripe_sandbox', kind: 'card_renewal_waiting', revision: 'e323b2a1-37fb-4c01-ba0f-817321df1a7e',
  customer_id: 'cus_fixture_owner', subscription_id: 'sub_fixture_annual', price_id: env.WEBSITE_STRIPE_SANDBOX_PRICE_ID,
  next_period_start: periodStart,
};

function invoiceFixture() {
  return {
    object: 'invoice', id: 'in_fixture_annual', livemode: false, billing_reason: 'subscription_cycle',
    collection_method: 'charge_automatically', total: 6000, amount_due: 6000, currency: 'jpy',
    subscription: initial.subscription_id, customer: initial.customer_id,
    subscription_details: { metadata: { site_id: siteId, purpose: 'sho_hp_renewal' } },
    lines: { has_more: false, data: [{
      type: 'subscription', proration: false, quantity: 1, amount: 6000,
      price: { id: initial.price_id, currency: 'jpy', unit_amount: 6000, recurring: { interval: 'year', interval_count: 1 } },
      period: { start: periodStart, end: periodEnd },
    }] },
    status: 'open', paid: false, amount_paid: 0, attempted: true, attempt_count: 1,
    payment_intent: {
      object: 'payment_intent', livemode: false, invoice: 'in_fixture_annual', customer: initial.customer_id,
      currency: 'jpy', amount: 6000, status: 'requires_payment_method',
      last_payment_error: { type: 'card_error', code: 'card_declined', payment_method: { type: 'card' } },
    },
  };
}

function paidInvoice(invoice) {
  return {
    ...invoice, status: 'paid', paid: true, paid_out_of_band: false, amount_paid: 6000, amount_remaining: 0,
    status_transitions: { paid_at: periodStart + 3600 },
    payment_intent: {
      ...invoice.payment_intent, status: 'succeeded', amount_received: 6000, last_payment_error: null,
      latest_charge: { object: 'charge', livemode: false, paid: true, captured: true,
        amount_captured: 6000, amount_refunded: 0, currency: 'jpy', payment_method_details: { type: 'card' } },
    },
  };
}

function eventFixture(type = 'invoice.payment_failed', overrides = {}) {
  return {
    object: 'event', id: 'evt_fixture_annual', created: periodStart + 30, type, livemode: false,
    data: { object: { object: 'invoice', id: 'in_fixture_annual', livemode: false, attempt_count: 1 } }, ...overrides,
  };
}

function signedRequest(event, { timestamp = Math.floor(Date.now() / 1000), secret = signingSecret, tamper = false } = {}) {
  const body = JSON.stringify(event);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return new Request('https://hp-fixture.supabase.co/functions/v1/website-stripe-renewal-sandbox', {
    method: 'POST', body: body + (tamper ? ' ' : ''), headers: {
      'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${'0'.repeat(64)},v1=${signature}`,
    },
  });
}

test('only valid signed sandbox events can start an invoice lookup', async () => {
  const noDb = { from() { assert.fail('Unexpected access to billing data'); } };
  const liveUrl = 'https://tyhymvgjkoebetyypspj.supabase.co';
  for (const disabled of [{}, { ...env, WEBSITE_STRIPE_SANDBOX_KEY: 'sk_live_fixture' },
    { ...env, SUPABASE_URL: liveUrl, WEBSITE_STRIPE_SANDBOX_SUPABASE_URL: liveUrl }]) {
    const endpoint = await edgeHarness({ slug, admin: noDb, env: disabled });
    assert.equal((await endpoint.handler(signedRequest(eventFixture()))).status, 404);
    assert.equal(endpoint.requests.length, 0);
  }
  const endpoint = await edgeHarness({ slug, admin: noDb, env });
  for (const options of [{ secret: 'whsec_wrong' }, { tamper: true }, { timestamp: Math.floor(Date.now() / 1000) - 301 }]) {
    assert.equal((await endpoint.handler(signedRequest(eventFixture(), options))).status, 400);
  }
  for (const event of [eventFixture('customer.subscription.updated'), eventFixture('invoice.paid', { livemode: true }),
    eventFixture('invoice.paid', { account: 'acct_elsewhere' })]) {
    assert.equal((await (await endpoint.handler(signedRequest(event))).json()).code, 'ignored');
  }
  assert.equal(endpoint.requests.length + endpoint.messages.length, 0);
});

test('signed Stripe fixtures update only the matching contract and its owner notice', async (t) => {
  const db = await resourceDatabase();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./fixtures/hosting-base.sql', import.meta.url), 'utf8'));
  await db.exec('set role service_role');
  await db.query('insert into public.website_sites(site_id) values($1)', [siteId]);
  await db.query("insert into public.website_site_users(site_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer')", [siteId, owner, viewer]);
  await db.query('insert into public.website_settings(key,value) values($1,$2)', [noticeKey, JSON.stringify(initial)]);
  const admin = postgrestFixture(db);
  const storage = async () => (await db.query('select value from public.website_settings where key=$1', [noticeKey])).rows[0].value;
  const portal = await edgeHarness({ slug: 'website-api/index.ts', admin, users: { owner: { id: owner }, viewer: { id: viewer } } });
  const list = async (who) => {
    const response = await portal.handler(new Request('https://hp-fixture.supabase.co/functions/v1/website-api', {
      method: 'POST', headers: { authorization: `Bearer ${who}`, 'content-type': 'application/json' }, body: '{"action":"list_sites"}',
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const fixture = invoiceFixture();
  let result = fixture;
  let available = true;
  let beforeWrite;
  const webhookAdmin = postgrestFixture({ async query(sql, values) {
    if (beforeWrite && sql.startsWith('update public.website_settings ')) {
      const completeCompetingPayment = beforeWrite;
      beforeWrite = undefined;
      await completeCompetingPayment();
    }
    return db.query(sql, values);
  } });
  const endpoint = await edgeHarness({ slug, admin: webhookAdmin, env, fetcher: (path, options) => {
    const url = new URL(path);
    assert.equal(url.origin + url.pathname, 'https://api.stripe.com/v1/invoices/in_fixture_annual');
    assert.equal(url.searchParams.get('expand[]'), 'payment_intent.latest_charge');
    assert.equal(options.headers['Stripe-Version'], '2025-02-24.acacia');
    assert.equal(options.headers.Authorization, `Bearer ${env.WEBSITE_STRIPE_SANDBOX_KEY}`);
    return available ? Response.json(result) : new Response(null, { status: 503 });
  } });

  const fire = async (event = eventFixture()) => {
    const response = await endpoint.handler(signedRequest(event));
    return { status: response.status, code: (await response.json()).code };
  };

  for (const change of [{ subscription: 'sub_other_site' }, { customer: 'cus_other_customer' }, { total: 0 },
    { billing_reason: 'subscription_create' }, { livemode: true }, { attempt_count: 2 },
    { payment_intent: { ...fixture.payment_intent, status: 'requires_action' } },
    { lines: { ...fixture.lines, data: [{ ...fixture.lines.data[0], price: { ...fixture.lines.data[0].price, id: 'price_other' } }] } }]) {
    result = { ...fixture, ...change };
    assert.equal((await fire()).code, 'ignored');
    assert.deepEqual(await storage(), initial);
  }
  available = false;
  assert.equal((await fire()).status, 503);
  assert.deepEqual(await storage(), initial);
  available = true;
  result = fixture;

  assert.equal((await fire()).code, 'failure_recorded');
  const failed = await storage();
  assert.equal(failed.kind, 'card_renewal_failed');
  assert.equal(failed.next_period_start, periodStart);
  assert.equal((await fire()).code, 'ignored');
  assert.deepEqual(await storage(), failed);
  assert.deepEqual((await list('owner')).billing_notices, [{ site_id: siteId, kind: failed.kind, failed_at: new Date((periodStart + 30) * 1000).toISOString() }]);
  assert.deepEqual((await list('viewer')).billing_notices, []);

  result = { ...paidInvoice(fixture), paid_out_of_band: true };
  assert.equal((await fire(eventFixture('invoice.paid'))).code, 'ignored');
  assert.deepEqual(await storage(), failed);

  result = { ...fixture, attempt_count: 2 };
  const secondFailure = eventFixture('invoice.payment_failed', { created: periodStart + 120, data: {
    object: { object: 'invoice', id: fixture.id, livemode: false, attempt_count: 2 },
  } });
  beforeWrite = async () => {
    result = paidInvoice(fixture);
    assert.equal((await fire(eventFixture('invoice.paid'))).code, 'paid_recorded');
  };
  assert.deepEqual(await fire(secondFailure), { status: 503, code: 'sandbox_storage_retry' });
  assert.equal((await fire(secondFailure)).code, 'ignored');
  const paid = await storage();
  assert.equal(paid.kind, 'card_renewal_paid');
  assert.equal(paid.next_period_start, periodEnd);
  assert.equal(paid.failed_at, null);
  assert.deepEqual((await list('owner')).billing_notices, []);
  result = fixture;
  assert.equal((await fire()).code, 'ignored');
  assert.deepEqual(await storage(), paid);
  assert.equal(endpoint.messages.length + portal.messages.length + portal.requests.length, 0);
  assert.equal((await db.query('select status from public.website_sites where site_id=$1', [siteId])).rows[0].status, 'building');
});
