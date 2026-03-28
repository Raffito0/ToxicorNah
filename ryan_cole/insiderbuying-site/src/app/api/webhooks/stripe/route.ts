export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

const PLAN_PRO = "pro";

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

function resolveId(
  field: string | { id: string } | null | undefined
): string | undefined {
  if (typeof field === "string") return field;
  return field?.id;
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
      const subscriptionId = resolveId(session.subscription as string | { id: string } | null);
      const customerId = resolveId(session.customer as string | { id: string } | null);

      if (userId && subscriptionId) {
        const { error: subErr } = await admin()
          .from("subscriptions")
          .upsert({
            user_id: userId,
            stripe_subscription_id: subscriptionId,
            plan: PLAN_PRO,
            status: "active",
            current_period_start: new Date().toISOString(),
          });

        if (subErr) {
          console.error("checkout.session.completed: subscriptions upsert failed:", subErr);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }

        const { error: profErr } = await admin()
          .from("profiles")
          .update({
            subscription_tier: PLAN_PRO,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
          })
          .eq("id", userId);

        if (profErr) {
          console.error("checkout.session.completed: profiles update failed:", profErr);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
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
      const { error } = await admin()
        .from("subscriptions")
        .update(updateData)
        .eq("stripe_subscription_id", sub.id);

      if (error) {
        console.error("customer.subscription.updated: update failed:", error);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      break;
    }

    case "customer.subscription.deleted": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = event.data.object as any;
      const { error: subErr } = await admin()
        .from("subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", sub.id);

      if (subErr) {
        console.error("customer.subscription.deleted: subscriptions update failed:", subErr);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }

      const { error: profErr } = await admin()
        .from("profiles")
        .update({ subscription_tier: "free" })
        .eq("stripe_subscription_id", sub.id);

      if (profErr) {
        console.error("customer.subscription.deleted: profiles update failed:", profErr);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      break;
    }

    case "customer.subscription.created": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = event.data.object as any;
      const userId = sub.metadata?.userId;
      if (!userId) {
        console.warn("customer.subscription.created: no userId in metadata, skipping", sub.id);
        break;
      }
      const { error } = await admin().from("subscriptions").upsert({
        user_id: userId,
        stripe_subscription_id: sub.id,
        plan: PLAN_PRO,
        status: sub.status,
        current_period_start: new Date(
          sub.current_period_start * 1000
        ).toISOString(),
        current_period_end: new Date(
          sub.current_period_end * 1000
        ).toISOString(),
      });

      if (error) {
        console.error("customer.subscription.created: upsert failed:", error);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      break;
    }

    case "invoice.paid": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as any;
      const subscriptionId = resolveId(invoice.subscription);
      if (subscriptionId) {
        const { error } = await admin()
          .from("subscriptions")
          .update({
            status: "active",
            current_period_start: new Date(
              invoice.period_start * 1000
            ).toISOString(),
            current_period_end: new Date(
              invoice.period_end * 1000
            ).toISOString(),
          })
          .eq("stripe_subscription_id", subscriptionId);

        if (error) {
          console.error("invoice.paid: update failed:", error);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
      }
      break;
    }

    case "invoice.payment_failed": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as any;
      const subscriptionId = resolveId(invoice.subscription);
      if (subscriptionId) {
        const { error } = await admin()
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", subscriptionId);

        if (error) {
          console.error("invoice.payment_failed: update failed:", error);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
      }
      break;
    }

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
