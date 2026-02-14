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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({
          isActive: false,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          isActive: false,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Get subscription from database
    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!subscription) {
      return new Response(
        JSON.stringify({
          isActive: false,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Verify with Stripe if needed
    let isActive = subscription.status === 'active';
    let cancelAtPeriodEnd = subscription.cancel_at_period_end;
    let currentPeriodEnd = subscription.current_period_end;

    if (subscription.stripe_subscription_id) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
        isActive = stripeSubscription.status === 'active';
        cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;
        currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000).toISOString();

        // Update local cache if different
        if (subscription.status !== (isActive ? 'active' : 'canceled') ||
            subscription.cancel_at_period_end !== cancelAtPeriodEnd) {
          await supabase
            .from('user_subscriptions')
            .update({
              status: isActive ? 'active' : 'canceled',
              cancel_at_period_end: cancelAtPeriodEnd,
              current_period_end: currentPeriodEnd,
              updated_at: new Date().toISOString()
            })
            .eq('id', subscription.id);
        }
      } catch (stripeError) {
        console.error('Error fetching Stripe subscription:', stripeError);
      }
    }

    return new Response(
      JSON.stringify({
        isActive,
        cancelAtPeriodEnd,
        currentPeriodEnd
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error getting subscription status:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
