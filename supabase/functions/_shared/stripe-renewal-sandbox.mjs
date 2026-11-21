import { HOSTING_OFFER } from './hosting-offer.mjs';

export const stripeApiVersion = '2026-11-18.endive';
export const stripeNoticePrefix = 'hosting_card_renewal_notice:';
export const stripeEventBodyLimit = 256 * 1024;
const scope = 'sho_hp_renewal';
const renewalFee = HOSTING_OFFER.renewal_fee_jpy;
const daySeconds = 86_400;
const encoder = new TextEncoder();

const stripeId = (value, prefix) => typeof value === 'string' && value.startsWith(prefix)
  && /^[a-zA-Z0-9_]{5,100}$/.test(value);
const epochSeconds = (value) => Number.isSafeInteger(value) && value > 0 && value <= 253_402_300_799;
const isoTime = (seconds) => new Date(seconds * 1000).toISOString();

export async function signedStripeInvoiceEvent(bytes, header, secret, nowSeconds) {
  const parts = header.split(',').map((part) => part.trim());
  const times = parts.filter((part) => part.startsWith('t='));
  if (times.length !== 1 || !/^t=\d{1,12}$/.test(times[0])) throw new Error('Invalid Stripe signature header');
  const timestamp = times[0].slice(2);
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) throw new Error('Expired Stripe signature');
  const signatures = parts.filter((part) => /^v1=[a-fA-F0-9]{64}$/.test(part));
  if (!signatures.length) throw new Error('Missing Stripe signature');

  const prefix = encoder.encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + bytes.length);
  message.set(prefix);
  message.set(bytes, prefix.length);
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const entry of signatures) {
    const signature = Uint8Array.from(entry.slice(3).match(/../g), (pair) => parseInt(pair, 16));
    if (await crypto.subtle.verify('HMAC', key, signature, message)) {
      const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (event?.object !== 'event' || !stripeId(event.id, 'evt_') || !epochSeconds(event.created)) throw new Error('Invalid Stripe event');
      const invoice = event.data?.object;
      if (event.livemode !== false || event.account || invoice?.object !== 'invoice' || invoice.livemode !== false) return null;
      if (event.type !== 'invoice.payment_failed' && event.type !== 'invoice.paid') return null;
      if (!stripeId(invoice.id, 'in_')) throw new Error('Invalid Stripe invoice');
      return { invoiceId: invoice.id, type: event.type, created: event.created, attemptCount: invoice.attempt_count };
    }
  }
  throw new Error('Invalid Stripe signature');
}

// A signed event selects an invoice for retrieval. It does not determine the current payment outcome.
export function sandboxRenewalInvoice(invoice, event, priceId) {
  const subscription = invoice?.parent?.type === 'subscription_details' ? invoice.parent.subscription_details : null;
  const meta = subscription?.metadata;
  if (invoice?.object !== 'invoice' || invoice.id !== event.invoiceId || invoice.livemode !== false
    || invoice.billing_reason !== 'subscription_cycle' || invoice.collection_method !== 'charge_automatically'
    || invoice.currency !== 'jpy' || invoice.total !== renewalFee || invoice.amount_due !== renewalFee
    || !stripeId(subscription?.subscription, 'sub_') || !stripeId(invoice.customer, 'cus_')
    || meta?.purpose !== scope || typeof meta.site_id !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(meta.site_id)) return null;

  const lines = invoice.lines;
  const line = lines?.data?.[0];
  const item = line?.parent?.type === 'subscription_item_details' ? line.parent.subscription_item_details : null;
  const start = line?.period?.start;
  const end = line?.period?.end;
  if (lines?.has_more !== false || !Array.isArray(lines.data) || lines.data.length !== 1
    || line?.object !== 'line_item' || line.invoice !== invoice.id || item?.subscription !== subscription.subscription
    || item.proration !== false || line.quantity !== 1 || line.amount !== renewalFee || line.currency !== 'jpy'
    || line.pricing?.type !== 'price_details' || line.pricing.price_details?.price !== priceId
    || !epochSeconds(start) || !epochSeconds(end) || end - start < 365 * daySeconds || end - start > 366 * daySeconds) return null;

  return { siteId: meta.site_id, invoiceId: invoice.id, customerId: invoice.customer, subscriptionId: subscription.subscription, priceId, start, end };
}

export function sandboxRenewalPayment(invoice, billing, event, payments) {
  const payment = payments?.data?.[0];
  if (payments?.object !== 'list' || payments.has_more !== false || !Array.isArray(payments.data) || payments.data.length !== 1
    || payment?.object !== 'invoice_payment' || payment.invoice !== invoice.id || payment.livemode !== false
    || payment.is_default !== true || payment.amount_requested !== renewalFee || payment.currency !== 'jpy'
    || payment.payment?.type !== 'payment_intent') return null;

  const intent = payment.payment.payment_intent;
  if (intent?.object !== 'payment_intent' || !stripeId(intent.id, 'pi_') || intent.livemode !== false
    || intent.customer !== invoice.customer || intent.currency !== 'jpy' || intent.amount !== renewalFee) return null;
  const charge = intent.latest_charge;

  if (invoice.status === 'paid' && payment.status === 'paid' && payment.amount_paid === renewalFee
    && invoice.amount_paid === renewalFee && invoice.amount_remaining === 0 && epochSeconds(invoice.status_transitions?.paid_at)
    && intent.status === 'succeeded' && intent.amount_received === renewalFee
    && charge?.object === 'charge' && charge.livemode === false && charge.paid === true && charge.captured === true
    && charge.payment_intent === intent.id && charge.customer === invoice.customer
    && charge.amount_captured === renewalFee && charge.amount_refunded === 0 && charge.currency === 'jpy'
    && charge.payment_method_details?.type === 'card') {
    return { ...billing, status: 'paid', at: isoTime(invoice.status_transitions.paid_at) };
  }

  const error = intent.last_payment_error;
  const attempts = invoice.attempt_count;
  if (event.type === 'invoice.payment_failed' && event.created >= billing.start && invoice.status === 'open' && invoice.attempted === true
    && invoice.amount_paid === 0 && invoice.amount_remaining === renewalFee && Number.isSafeInteger(attempts) && attempts > 0
    && attempts === event.attemptCount && payment.status === 'open' && payment.amount_paid === null
    && intent.status === 'requires_payment_method' && error?.type === 'card_error' && error.code !== 'authentication_required'
    && error.decline_code !== 'authentication_required'
    && (error.payment_method?.type === 'card' || charge?.payment_method_details?.type === 'card')) {
    return { ...billing, status: 'failed', at: isoTime(event.created), attempts };
  }
  return null;
}

export function nextSandboxRenewalRecord(current, invoice, revision) {
  if (current?.mode !== 'stripe_sandbox' || typeof current.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(current.revision)
    || current.customer_id !== invoice.customerId || current.subscription_id !== invoice.subscriptionId
    || current.price_id !== invoice.priceId || current.next_period_start !== invoice.start
    || (current.open_invoice_id && current.open_invoice_id !== invoice.invoiceId)) return null;

  if (invoice.status === 'failed') {
    if (current.open_invoice_id === invoice.invoiceId && current.attempt_count >= invoice.attempts) return null;
    return { ...current, revision, kind: 'card_renewal_failed', failed_at: invoice.at, open_invoice_id: invoice.invoiceId, attempt_count: invoice.attempts };
  }

  return {
    ...current, revision, kind: 'card_renewal_paid', paid_at: invoice.at, failed_at: null,
    last_paid_invoice_id: invoice.invoiceId, open_invoice_id: null, attempt_count: 0, next_period_start: invoice.end,
  };
}
