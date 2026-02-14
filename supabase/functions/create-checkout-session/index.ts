import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
});

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { priceId, mode, userId, sessionId, analysisId, successUrl, cancelUrl } = await req.json();

    // Get or create Stripe customer
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let stripeCustomerId: string | undefined;

    if (userId) {
      // Check if user already has a Stripe customer ID
      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (subscription?.stripe_customer_id) {
        stripeCustomerId = subscription.stripe_customer_id;
      } else {
        // Get user email
        const { data: { user } } = await supabase.auth.admin.getUserById(userId);

        // Create new Stripe customer
        const customer = await stripe.customers.create({
          email: user?.email,
          metadata: {
            supabase_user_id: userId,
            session_id: sessionId
          }
        });
        stripeCustomerId = customer.id;
      }
    }

    // Create Checkout Session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: mode as 'subscription' | 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: userId || '',
        session_id: sessionId,
        analysis_id: analysisId || '',
        payment_type: mode === 'subscription' ? 'subscription' : 'single_unlock'
      },
    };

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId;
    }

    // For subscriptions, allow promotion codes
    if (mode === 'subscription') {
      sessionParams.allow_promotion_codes = true;
    }

    const checkoutSession = await stripe.checkout.sessions.create(sessionParams);

    return new Response(
      JSON.stringify({ url: checkoutSession.url }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
