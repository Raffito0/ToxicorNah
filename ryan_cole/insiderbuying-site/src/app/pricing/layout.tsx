import type { Metadata } from "next";
import { buildProductJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  title: "Pricing | EarlyInsider",
  description:
    "EarlyInsider pricing plans: Free alerts, Analyst ($24/mo), and Investor ($99/mo). Real-time insider trading intelligence with 14-day free trial.",
  openGraph: {
    title: "Pricing | EarlyInsider",
    description:
      "Free, Analyst, and Investor plans for real-time insider trading intelligence.",
    url: "https://earlyinsider.com/pricing",
  },
};

const productJsonLd = buildProductJsonLd({
  name: "EarlyInsider Pro",
  description:
    "Real-time SEC insider trading alerts with AI-powered conviction scoring, deep-dive reports, and API access.",
  price: "24",
  currency: "USD",
  url: "https://earlyinsider.com/pricing",
});

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      {children}
    </>
  );
}
