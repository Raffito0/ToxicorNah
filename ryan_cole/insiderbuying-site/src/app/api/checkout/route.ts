export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import type Stripe from "stripe";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { priceId, coupon } = await request.json();

  if (!priceId) {
    return NextResponse.json(
      { error: "Missing priceId" },
      { status: 400 }
    );
  }

  const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "https://earlyinsider.com";

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/alerts?checkout=success`,
    cancel_url: `${origin}/pricing`,
    customer_email: user.email!,
    metadata: { userId: user.id },
  };

  if (coupon) {
    params.discounts = [{ coupon }];
  }

  const session = await getStripe().checkout.sessions.create(params);

  return NextResponse.json({ url: session.url });
}
