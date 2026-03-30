export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const BEEHIIV_API_KEY = process.env.BEEHIIV_API_KEY;
const BEEHIIV_PUB_ID = process.env.BEEHIIV_PUB_ID || "pub_dcded333-1d74-4dc3-90fe-f6e6f968b4e7";

export async function POST(request: Request) {
  if (!BEEHIIV_API_KEY) {
    return NextResponse.json({ error: "Newsletter service not configured" }, { status: 500 });
  }

  const body = await request.json();
  const email = body.email?.trim()?.toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.beehiiv.com/v2/publications/${BEEHIIV_PUB_ID}/subscriptions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BEEHIIV_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        reactivate_existing: true,
        send_welcome_email: true,
        utm_source: body.source || "website",
        utm_medium: body.placement || "inline",
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("[newsletter/subscribe] Beehiiv error:", res.status, err);
    return NextResponse.json({ error: "Subscription failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
