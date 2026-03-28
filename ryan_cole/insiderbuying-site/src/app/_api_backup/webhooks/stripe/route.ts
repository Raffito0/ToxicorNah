export const dynamic = "force-static";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe webhook verification failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;

      if (userId && subscriptionId) {
        await admin().from("subscriptions").upsert({
          user_id: userId,
          stripe_subscription_id: subscriptionId,
          plan: "pro",
          status: "active",
          current_period_start: new Date().toISOString(),
        });

        await admin()
          .from("profiles")
          .update({
            subscription_tier: "pro",
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
          })
          .eq("id", userId);
      }
      break;
    }

    case "customer.subscription.updated": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = event.data.object as any;
      const updateData: Record<string, unknown> = {
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
      };
      if (sub.current_period_start) {
        updateData.current_period_start = new Date(
          sub.current_period_start * 1000
        ).toISOString();
      }
      if (sub.current_period_end) {
        updateData.current_period_end = new Date(
          sub.current_period_end * 1000
        ).toISOString();
      }
      await admin()
        .from("subscriptions")
        .update(updateData)
        .eq("stripe_subscription_id", sub.id);
      break;
    }

    case "customer.subscription.deleted": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = event.data.object as any;
      await admin()
        .from("subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", sub.id);
      await admin()
        .from("profiles")
        .update({ subscription_tier: "free" })
        .eq("stripe_subscription_id", sub.id);
      break;
    }

    case "invoice.payment_failed": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as any;
      const subscriptionId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;
      if (subscriptionId) {
        await admin()
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", subscriptionId);
      }
      break;
    }

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
