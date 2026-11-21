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
    customer: initial.customer_id,
    parent: { type: 'subscription_details', subscription_details: {
      subscription: initial.subscription_id, metadata: { site_id: siteId, purpose: 'sho_hp_renewal' },
    } },
    lines: { has_more: false, data: [{
      object: 'line_item', invoice: 'in_fixture_annual', quantity: 1, amount: 6000, currency: 'jpy',
      parent: { type: 'subscription_item_details', subscription_item_details: { proration: false, subscription: initial.subscription_id } },
      pricing: { type: 'price_details', price_details: { price: initial.price_id } },
      period: { start: periodStart, end: periodEnd },
    }] },
    status: 'open', amount_paid: 0, amount_remaining: 6000, attempted: true, attempt_count: 1,
  };
}

function paymentsFixture(paid = false) {
  const intent = {
    object: 'payment_intent', id: 'pi_fixture_annual', livemode: false, customer: initial.customer_id,
    currency: 'jpy', amount: 6000,
    ...(paid ? {
      status: 'succeeded', amount_received: 6000,
      latest_charge: { object: 'charge', livemode: false, payment_intent: 'pi_fixture_annual', customer: initial.customer_id,
        paid: true, captured: true, amount_captured: 6000, amount_refunded: 0, currency: 'jpy', payment_method_details: { type: 'card' } },
    } : {
      status: 'requires_payment_method',
      last_payment_error: { type: 'card_error', code: 'card_declined', payment_method: { type: 'card' } },
    }),
  };
  return {
    object: 'list', has_more: false, data: [{ object: 'invoice_payment', invoice: 'in_fixture_annual', livemode: false,
      is_default: true, currency: 'jpy', amount_requested: 6000, status: paid ? 'paid' : 'open', amount_paid: paid ? 6000 : null,
      payment: { type: 'payment_intent', payment_intent: intent } }],
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
  const settledInvoice = { ...fixture, status: 'paid', amount_paid: 6000, amount_remaining: 0, status_transitions: { paid_at: periodStart + 3600 } };
  const failedPayments = paymentsFixture();
  const paidPayments = paymentsFixture(true);
  let result = fixture;
  let payments = failedPayments;
  let unavailable;
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
    assert.equal(url.origin, 'https://api.stripe.com');
    assert.equal(options.headers['Stripe-Version'], '2026-11-18.endive');
    assert.equal(options.headers.Authorization, `Bearer ${env.WEBSITE_STRIPE_SANDBOX_KEY}`);
    if (url.pathname === `/v1/invoices/${fixture.id}`) {
      return unavailable === 'invoice' ? new Response(null, { status: 503 }) : Response.json(result);
    }
    assert.equal(url.pathname, '/v1/invoice_payments');
    assert.equal(url.searchParams.get('invoice'), fixture.id);
    assert.equal(url.searchParams.get('limit'), '2');
    assert.equal(url.searchParams.get('expand[]'), 'data.payment.payment_intent.latest_charge');
    return unavailable === 'payments' ? new Response(null, { status: 503 }) : Response.json(payments);
  } });

  const fire = async (event = eventFixture()) => {
    const response = await endpoint.handler(signedRequest(event));
    return { status: response.status, code: (await response.json()).code };
  };

  const line = fixture.lines.data[0];
  for (const change of [{ parent: { ...fixture.parent, subscription_details: { ...fixture.parent.subscription_details, subscription: 'sub_other_site' } } },
    { customer: 'cus_other_customer' }, { total: 0 }, { billing_reason: 'subscription_create' }, { livemode: true }, { attempt_count: 2 },
    { lines: { ...fixture.lines, data: [{ ...line, pricing: { ...line.pricing, price_details: { price: 'price_other' } } }] } }]) {
    result = { ...fixture, ...change };
    assert.equal((await fire()).code, 'ignored');
    assert.deepEqual(await storage(), initial);
  }
  result = fixture;
  for (const stage of ['invoice', 'payments']) {
    unavailable = stage;
    assert.deepEqual(await fire(), { status: 503, code: 'stripe_check_unavailable' });
    assert.deepEqual(await storage(), initial);
  }
  unavailable = undefined;
  const failedPayment = failedPayments.data[0];
  payments = { ...failedPayments, data: [{ ...failedPayment, payment: { ...failedPayment.payment,
    payment_intent: { ...failedPayment.payment.payment_intent, status: 'requires_action' } } }] };
  assert.equal((await fire()).code, 'ignored');
  assert.deepEqual(await storage(), initial);
  payments = failedPayments;

  assert.equal((await fire()).code, 'failure_recorded');
  const failed = await storage();
  assert.equal(failed.kind, 'card_renewal_failed');
  assert.equal(failed.next_period_start, periodStart);
  assert.equal((await fire()).code, 'ignored');
  assert.deepEqual(await storage(), failed);
  assert.deepEqual((await list('owner')).billing_notices, [{ site_id: siteId, kind: failed.kind, failed_at: new Date((periodStart + 30) * 1000).toISOString() }]);
  assert.deepEqual((await list('viewer')).billing_notices, []);

  result = settledInvoice;
  const paidPayment = paidPayments.data[0];
  for (const data of [[], [{ ...paidPayment, payment: { type: 'payment_record', payment_record: 'payrec_manual' } }],
    [{ ...paidPayment, invoice: 'in_other_invoice' }], [paidPayment, paidPayment]]) {
    payments = { ...paidPayments, data };
    assert.equal((await fire(eventFixture('invoice.paid'))).code, 'ignored');
    assert.deepEqual(await storage(), failed);
  }

  result = { ...fixture, attempt_count: 2 };
  payments = failedPayments;
  const secondFailure = eventFixture('invoice.payment_failed', { created: periodStart + 120, data: {
    object: { object: 'invoice', id: fixture.id, livemode: false, attempt_count: 2 },
  } });
  beforeWrite = async () => {
    result = settledInvoice;
    payments = paidPayments;
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
  payments = failedPayments;
  assert.equal((await fire()).code, 'ignored');
  assert.deepEqual(await storage(), paid);
  assert.equal(endpoint.messages.length + portal.messages.length + portal.requests.length, 0);
  assert.equal((await db.query('select status from public.website_sites where site_id=$1', [siteId])).rows[0].status, 'building');
});
