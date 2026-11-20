import { adminClient } from '../_shared/website.ts';
import {
  nextSandboxRenewalRecord, sandboxRenewalInvoice, signedStripeInvoiceEvent, stripeApiVersion, stripeEventBodyLimit, stripeNoticePrefix,
} from '../_shared/stripe-renewal-sandbox.mjs';

const reply = (code: string, status = 200) => Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
const salesProjectRef = 'tyhymvgjkoebetyypspj';

function sandboxSettings() {
  const get = (key: string) => Deno.env.get(`WEBSITE_STRIPE_SANDBOX_${key}`) || '';
  const sandboxUrl = get('SUPABASE_URL');
  const key = get('KEY');
  const signingSecret = get('SIGNING_SECRET');
  const priceId = get('PRICE_ID');
  if (!sandboxUrl || sandboxUrl !== Deno.env.get('SUPABASE_URL') || sandboxUrl.includes(salesProjectRef)
    || !/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(key) || !/^whsec_[A-Za-z0-9_]+$/.test(signingSecret)
    || !/^price_[A-Za-z0-9_]+$/.test(priceId)) return null;
  return { key, signingSecret, priceId };
}

async function readBody(request: Request) {
  if (Number(request.headers.get('content-length')) > stripeEventBodyLimit) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > stripeEventBodyLimit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply('method_not_allowed', 405);
  const config = sandboxSettings();
  if (!config) return reply('sandbox_disabled', 404);
  const signature = request.headers.get('stripe-signature');
  if (!signature || signature.length > 4096) return reply('invalid_signature', 400);

  let event;
  try {
    const bytes = await readBody(request);
    if (!bytes) return reply('invalid_body_size', 413);
    event = await signedStripeInvoiceEvent(bytes, signature, config.signingSecret, Math.floor(Date.now() / 1000));
  } catch {
    return reply('invalid_signature', 400);
  }
  if (!event) return reply('ignored');

  try {
    const url = new URL(`/v1/invoices/${event.invoiceId}`, 'https://api.stripe.com');
    url.searchParams.append('expand[]', 'payment_intent.latest_charge');
    const result = await fetch(url, {
      headers: { Authorization: `Bearer ${config.key}`, 'Stripe-Version': stripeApiVersion },
      redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!result.ok) return reply('stripe_check_unavailable', 503);
    const invoice = sandboxRenewalInvoice(await result.json(), event, config.priceId);
    if (!invoice) return reply('ignored');

    const admin = adminClient();
    const key = stripeNoticePrefix + invoice.siteId;
    const { data: row, error: readError } = await admin.from('website_settings').select('value').eq('key', key).maybeSingle();
    if (readError) return reply('sandbox_storage_unavailable', 503);
    if (!row) return reply('ignored');
    const next = nextSandboxRenewalRecord(row.value, invoice, crypto.randomUUID());
    if (!next) return reply('ignored');

    const { data: updated, error: updateError } = await admin.from('website_settings').update({ value: next, updated_at: new Date().toISOString() })
      .eq('key', key).eq('value->>revision', row.value.revision).select('key').maybeSingle();
    if (updateError || !updated) return reply('sandbox_storage_retry', 503);
    return reply(invoice.status === 'paid' ? 'paid_recorded' : 'failure_recorded');
  } catch {
    return reply('sandbox_unavailable', 503);
  }
});
