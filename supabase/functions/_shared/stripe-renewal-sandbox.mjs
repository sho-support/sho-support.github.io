import { HOSTING_OFFER } from './hosting-offer.mjs';

export const stripeApiVersion = '2025-02-24.acacia';
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
  const meta = invoice?.subscription_details?.metadata;
  if (invoice?.object !== 'invoice' || invoice.id !== event.invoiceId || invoice.livemode !== false
    || invoice.billing_reason !== 'subscription_cycle' || invoice.collection_method !== 'charge_automatically'
    || invoice.currency !== 'jpy' || invoice.total !== renewalFee || invoice.amount_due !== renewalFee
    || !stripeId(invoice.subscription, 'sub_') || !stripeId(invoice.customer, 'cus_')
    || meta?.purpose !== scope || typeof meta.site_id !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(meta.site_id)) return null;

  const lines = invoice.lines;
  const line = lines?.data?.[0];
  const price = line?.price;
  const start = line?.period?.start;
  const end = line?.period?.end;
  if (lines?.has_more !== false || !Array.isArray(lines.data) || lines.data.length !== 1
    || line?.type !== 'subscription' || line.proration !== false || line.quantity !== 1 || line.amount !== renewalFee
    || price?.id !== priceId || price.currency !== 'jpy' || price.unit_amount !== renewalFee
    || price.recurring?.interval !== 'year' || price.recurring.interval_count !== 1
    || !epochSeconds(start) || !epochSeconds(end) || end - start < 365 * daySeconds || end - start > 366 * daySeconds) return null;

  const intent = invoice.payment_intent;
  if (intent?.object !== 'payment_intent' || intent.livemode !== false || intent.invoice !== invoice.id
    || intent.customer !== invoice.customer || intent.currency !== 'jpy' || intent.amount !== renewalFee) return null;
  const charge = intent.latest_charge;
  const billing = { siteId: meta.site_id, invoiceId: invoice.id, customerId: invoice.customer, subscriptionId: invoice.subscription, priceId, start, end };

  if (invoice.status === 'paid' && invoice.paid === true && invoice.paid_out_of_band === false
    && invoice.amount_paid === renewalFee && invoice.amount_remaining === 0 && epochSeconds(invoice.status_transitions?.paid_at)
    && intent.status === 'succeeded' && intent.amount_received === renewalFee
    && charge?.object === 'charge' && charge.livemode === false && charge.paid === true && charge.captured === true
    && charge.amount_captured === renewalFee && charge.amount_refunded === 0 && charge.currency === 'jpy'
    && charge.payment_method_details?.type === 'card') {
    return { ...billing, status: 'paid', at: isoTime(invoice.status_transitions.paid_at) };
  }

  const error = intent.last_payment_error;
  const attempts = invoice.attempt_count;
  if (event.type === 'invoice.payment_failed' && event.created >= start && invoice.status === 'open' && invoice.attempted === true
    && invoice.paid === false && invoice.amount_paid === 0 && Number.isSafeInteger(attempts) && attempts > 0 && attempts === event.attemptCount
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
