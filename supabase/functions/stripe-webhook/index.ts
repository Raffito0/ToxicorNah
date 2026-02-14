import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata || {};

        if (session.mode === 'subscription') {
          // Handle subscription creation
          await handleSubscriptionCreated(supabase, session, metadata);
        } else if (session.mode === 'payment') {
          // Handle single unlock payment
          await handleSingleUnlockPayment(supabase, session, metadata);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(supabase, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(supabase, subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(supabase, invoice);
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400 }
    );
  }
});

async function handleSubscriptionCreated(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
  metadata: Record<string, string>
) {
  const subscriptionId = session.subscription as string;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const userId = metadata.user_id || null;
  const sessionId = metadata.session_id;

  // Create subscription record
  await supabase.from('user_subscriptions').upsert({
    user_id: userId,
    subscription_type: 'toxic_unlimited',
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: session.customer as string,
    status: 'active',
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
    updated_at: new Date().toISOString()
  }, {
    onConflict: 'user_id'
  });

  // Record transaction
  await supabase.from('payment_transactions').insert({
    user_id: userId,
    stripe_payment_intent_id: session.payment_intent as string,
    amount_cents: session.amount_total || 499,
    currency: session.currency || 'eur',
    payment_type: 'subscription',
    status: 'succeeded'
  });

  // Update tracking to mark as premium and unlock current analysis
  if (sessionId) {
    await supabase
      .from('user_analysis_tracking')
      .update({ updated_at: new Date().toISOString() })
      .eq('session_id', sessionId);
  }

  // Unlock the analysis if provided
  if (metadata.analysis_id) {
    await supabase
      .from('analysis_results')
      .update({
        is_unlocked: true,
        unlock_type: 'subscription'
      })
      .eq('id', metadata.analysis_id);
  }
}

async function handleSingleUnlockPayment(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
  metadata: Record<string, string>
) {
  const userId = metadata.user_id || null;
  const sessionId = metadata.session_id;
  const analysisId = metadata.analysis_id;

  // Record transaction
  await supabase.from('payment_transactions').insert({
    user_id: userId,
    stripe_payment_intent_id: session.payment_intent as string,
    amount_cents: session.amount_total || 199,
    currency: session.currency || 'eur',
    payment_type: 'single_unlock',
    status: 'succeeded'
  });

  // Unlock the specific analysis
  if (analysisId) {
    await supabase
      .from('analysis_results')
      .update({
        is_unlocked: true,
        unlock_type: 'single_purchase'
      })
      .eq('id', analysisId);
  }

  // Update user tracking
  if (sessionId) {
    const { data: tracking } = await supabase
      .from('user_analysis_tracking')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (tracking) {
      await supabase
        .from('user_analysis_tracking')
        .update({
          single_unlocks_used_this_month: (tracking.single_unlocks_used_this_month || 0) + 1,
          full_analyses_used: (tracking.full_analyses_used || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('session_id', sessionId);
    }
  }
}

async function handleSubscriptionUpdated(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription
) {
  const status = subscription.status === 'active' ? 'active' :
                 subscription.status === 'past_due' ? 'past_due' : 'canceled';

  await supabase
    .from('user_subscriptions')
    .update({
      status: status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription
) {
  await supabase
    .from('user_subscriptions')
    .update({
      status: 'canceled',
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handlePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice
) {
  if (invoice.subscription) {
    await supabase
      .from('user_subscriptions')
      .update({
        status: 'past_due',
        updated_at: new Date().toISOString()
      })
      .eq('stripe_subscription_id', invoice.subscription as string);
  }
}
