import Stripe from 'stripe';
import { getAdminClient, normalizeEmail } from './_shared.js';

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function amountFromSubscription(subscription) {
  return subscription?.items?.data?.[0]?.price?.unit_amount ?? null;
}

function periodEndFromSubscription(subscription) {
  return subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
}

async function retrieveCustomerEmail(stripe, customerId) {
  if (!customerId) return '';
  const customer = await stripe.customers.retrieve(String(customerId));
  if (customer.deleted) return '';
  return normalizeEmail(customer.email);
}

async function syncSubscription({ stripe, supabase, subscription, eventCreated, fallbackEmail = '' }) {
  const customerId = String(subscription.customer || '');
  const subscriptionId = String(subscription.id || '');
  let email = normalizeEmail(fallbackEmail);

  if (!email) email = await retrieveCustomerEmail(stripe, customerId);
  if (!email) throw new Error(`Customer email was not found for ${customerId || subscriptionId}.`);

  let existing = null;
  const byEmail = await supabase
    .from('supporters')
    .select('id, email, last_event_created')
    .eq('email', email)
    .maybeSingle();
  if (byEmail.error) throw byEmail.error;
  existing = byEmail.data;

  if (!existing && customerId) {
    const byCustomer = await supabase
      .from('supporters')
      .select('id, email, last_event_created')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (byCustomer.error) throw byCustomer.error;
    existing = byCustomer.data;
  }

  if (existing && Number(existing.last_event_created || 0) > Number(eventCreated || 0)) {
    return;
  }

  const payload = {
    email,
    stripe_customer_id: customerId || null,
    stripe_subscription_id: subscriptionId || null,
    status: subscription.status || 'inactive',
    plan_amount: amountFromSubscription(subscription),
    current_period_end: periodEndFromSubscription(subscription),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    last_event_created: Number(eventCreated || 0),
    updated_at: new Date().toISOString()
  };

  const result = existing
    ? await supabase.from('supporters').update(payload).eq('id', existing.id)
    : await supabase.from('supporters').insert(payload);
  if (result.error) throw result.error;
}

async function recordEvent(supabase, event) {
  const { error } = await supabase.from('webhook_events').insert({
    stripe_event_id: event.id,
    event_type: event.type
  });
  if (error && error.code !== '23505') throw error;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeKey || !webhookSecret) {
      throw new Error('Stripe environment variables are missing.');
    }

    const signature = req.headers['stripe-signature'];
    if (!signature) throw new Error('Stripe signature is missing.');

    const stripe = new Stripe(stripeKey, { maxNetworkRetries: 2 });
    const rawBody = await readRawBody(req);
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    const supabase = getAdminClient();

    const { data: duplicate, error: duplicateError } = await supabase
      .from('webhook_events')
      .select('stripe_event_id')
      .eq('stripe_event_id', event.id)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return res.status(200).json({ received: true, duplicate: true });

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
        await syncSubscription({
          stripe,
          supabase,
          subscription,
          eventCreated: event.created,
          fallbackEmail: session.customer_details?.email || session.customer_email || ''
        });
      }
    }

    const subscriptionEvents = new Set([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.paused',
      'customer.subscription.resumed'
    ]);

    if (subscriptionEvents.has(event.type)) {
      await syncSubscription({
        stripe,
        supabase,
        subscription: event.data.object,
        eventCreated: event.created
      });
    }

    if ((event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') && event.data.object.subscription) {
      const subscription = await stripe.subscriptions.retrieve(String(event.data.object.subscription));
      await syncSubscription({ stripe, supabase, subscription, eventCreated: event.created });
    }

    await recordEvent(supabase, event);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}
