import Stripe from 'stripe';
import { getAdminClient } from './_shared.js';

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function amountFromSubscription(subscription) {
  return subscription?.items?.data?.[0]?.price?.unit_amount || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeKey || !webhookSecret) throw new Error('Stripe environment variables are missing.');

    const stripe = new Stripe(stripeKey);
    const signature = req.headers['stripe-signature'];
    const rawBody = await readRawBody(req);
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    const supabase = getAdminClient();

    const { data: duplicate } = await supabase
      .from('webhook_events')
      .select('stripe_event_id')
      .eq('stripe_event_id', event.id)
      .maybeSingle();
    if (duplicate) return res.status(200).json({ received: true, duplicate: true });

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
        if (email) {
          await supabase.from('supporters').upsert({
            email,
            stripe_customer_id: String(session.customer),
            stripe_subscription_id: String(subscription.id),
            status: subscription.status,
            plan_amount: amountFromSubscription(subscription),
            current_period_end: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
            updated_at: new Date().toISOString()
          }, { onConflict: 'email' });
        }
      }
    }

    if (event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      await supabase.from('supporters').update({
        stripe_subscription_id: String(subscription.id),
        status: subscription.status,
        plan_amount: amountFromSubscription(subscription),
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString()
      }).eq('stripe_customer_id', String(subscription.customer));
    }

    await supabase.from('webhook_events').insert({
      stripe_event_id: event.id,
      event_type: event.type
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}
