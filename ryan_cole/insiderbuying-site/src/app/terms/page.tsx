import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | EarlyInsider",
  description:
    "EarlyInsider terms of service: usage agreement, liability limitations, and service conditions.",
};

export default function TermsPage() {
  return (
    <div className="bg-[var(--color-bg-alt)]">
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-hero-mobile)] pb-[var(--section-y-hero-mobile)] md:pt-[var(--section-y-hero)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto">
          <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[54px] font-normal leading-[1.1] text-[color:var(--color-text)] mb-[var(--gap-tight)]">Terms of Service</h1>
          <p className="text-[14px] text-[color:var(--color-text-muted)]">Last updated: March 2026</p>
        </div>
      </section>

      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto flex flex-col gap-[var(--gap-cards)]">
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">1. Acceptance of Terms</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">By accessing or using EarlyInsider, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use our services.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">2. Service Description</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">EarlyInsider provides financial data analytics, SEC Form 4 filing alerts, and AI-powered analysis of insider trading activity. Our platform aggregates publicly available data from the SEC EDGAR database and applies proprietary scoring models.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">3. Not Financial Advice</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">EarlyInsider is not a registered investment advisor, broker-dealer, or financial planner. All information provided through our platform is for educational and informational purposes only. Nothing on this site constitutes financial, legal, or tax advice. Past performance of insider trading signals does not guarantee future results. Always consult a qualified financial advisor before making investment decisions.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">4. Account Terms</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">You must provide accurate and complete information when creating an account. You are responsible for maintaining the security of your account credentials. You must be at least 18 years old to use our services.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">5. Subscription & Billing</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">Paid subscriptions are billed monthly or annually as selected. You may cancel at any time from your account settings. Cancellation takes effect at the end of the current billing period. No refunds are provided for partial billing periods.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">6. Intellectual Property</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">All content, analysis, scoring models, and proprietary data on EarlyInsider are owned by us. You may not reproduce, distribute, or create derivative works from our content without written permission.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">7. Limitation of Liability</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">EarlyInsider shall not be liable for any indirect, incidental, or consequential damages arising from your use of our services. Our total liability shall not exceed the amount paid by you in the 12 months preceding the claim.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">8. Contact</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">For questions about these terms, contact us at <a href="mailto:legal@earlyinsider.com" className="text-[color:var(--color-primary)] hover:underline">legal@earlyinsider.com</a>.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
