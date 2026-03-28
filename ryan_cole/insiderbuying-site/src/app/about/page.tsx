import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About | EarlyInsider",
  description:
    "Learn about EarlyInsider — our mission, team, and how we deliver real-time SEC insider trading alerts and AI-powered stock analysis.",
};

const STEPS = [
  { icon: "📄", title: "Ingest", desc: "17,325+ companies monitored on SEC EDGAR. Every Form 3, 4, and 13D captured within seconds." },
  { icon: "🧠", title: "Filter", desc: "80% of filings are noise. Our model classifies each by transaction type, isolating the 20% that signal conviction." },
  { icon: "🔔", title: "Score", desc: "Multi-factor conviction score (0-100) weighing trade size, track record, cluster activity, and sector context." },
  { icon: "📊", title: "Deliver", desc: "Filing to inbox: under 60 seconds. Email, Slack, or webhook." },
];

const TRUST_CARDS = [
  { icon: "🔒", title: "SEC EDGAR Source", desc: "All data sourced directly from SEC EDGAR. Every alert links to the original filing for verification." },
  { icon: "🤖", title: "Proprietary Scoring", desc: "Conviction scores computed from 7 weighted factors. Methodology published on the Methodology page." },
  { icon: "⚡", title: "Sub-60s Delivery", desc: "Median alert latency under 60 seconds. 99.998% platform uptime over trailing 12 months." },
];

export default function AboutPage() {
  return (
    <div className="bg-[var(--color-bg-alt)]">

      {/* ═══ SECTION 1: HEADER ═══ */}
      <section className="bg-[var(--color-primary)] pt-[var(--section-y-hero-mobile)] pb-[var(--section-y-hero-mobile)] md:pt-[var(--section-y-hero)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[24px] flex flex-col items-center justify-center">
        <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[54px] font-normal leading-[1.1] md:leading-[52px] text-white text-center mb-[16px] md:mb-[24px]">
          About EarlyInsider
        </h1>
        <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[29px] text-white text-center max-w-[620px]">
          SEC EDGAR publishes over 150,000 Form 4 insider trading filings per year. 80% are routine noise. The 20% that signal genuine conviction reach most investors 24-48 hours late.
        </p>
      </section>

      {/* ═══ SECTION 2: MISSION ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto">
          <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.15] md:leading-[42px] text-[color:var(--color-text)] mb-[24px] md:mb-[30px]">
            The Solution
          </h2>
          <div className="flex flex-col gap-[18px] md:gap-[22px]">
            <p className="text-[16px] md:text-[18px] font-normal leading-[28px] md:leading-[30px] text-[color:var(--color-text)]">
              EarlyInsider monitors SEC EDGAR continuously across 17,325+ companies and parses every Form 3, 4, and 13D filing within seconds of publication. Each filing runs through a conviction-scoring model that weighs trade size, executive track record, and cluster buying patterns.
            </p>
            <p className="text-[16px] md:text-[18px] font-normal leading-[28px] md:leading-[30px] text-[color:var(--color-text)]">
              Every data point traces back to an SEC filing or verified financial dataset. The platform takes clear analytical positions — BUY, CAUTION, WAIT, NO TRADE — with numeric thresholds and stated conditions that would change each thesis.
            </p>
            <p className="text-[16px] md:text-[18px] font-normal leading-[28px] md:leading-[30px] text-[color:var(--color-text)]">
              Stating what the system cannot do is as important as stating what it can. Limitations are published on the Methodology page.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 3: HOW IT WORKS ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[40px]">
        <div className="max-w-[1200px] mx-auto">
          <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.15] md:leading-[42px] text-[color:var(--color-text)] text-center mb-[40px] md:mb-[64px]">
            From SEC Filing to Your Dashboard
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[20px] md:gap-[var(--gap-items)] lg:px-[95px]">
            {STEPS.map((step) => (
              <div key={step.title} className="bg-white p-[24px] md:p-[32px]">
                <div className="text-[24px] mb-[var(--gap-tight)]">{step.icon}</div>
                <h3 className="text-[length:var(--text-subheading)] font-bold leading-[28px] text-[color:var(--color-text)] mb-[12px]">{step.title}</h3>
                <p className="text-[14px] font-normal leading-[23px] text-[color:var(--color-text)]">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4: DATA & TRUST ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[40px]">
        <div className="max-w-[1200px] mx-auto">
          <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.15] md:leading-[42px] text-[color:var(--color-text)] text-center mb-[40px] md:mb-[50px]">
            Institutional Grade Intelligence
          </h2>

          {/* Stats row */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-[var(--gap-cards)] md:gap-[60px] mb-[48px] md:mb-[64px]">
            {[
              { value: "$4.2B", label: "Insider transactions tracked (12 months)" },
              { value: "2,847", label: "Unique trades analyzed this month" },
              { value: "17,325+", label: "Companies monitored continuously" },
            ].map((stat, i) => (
              <div key={stat.value} className="flex items-center gap-[var(--gap-cards)] md:gap-[60px]">
                <div className="text-center md:text-left">
                  <p className="font-[var(--font-montaga)] text-[40px] md:text-[48px] font-normal leading-[40px] text-[color:var(--color-text)]">{stat.value}</p>
                  <p className="text-[14px] font-normal leading-[16px] text-[color:var(--color-text-secondary)] mt-[8px]">{stat.label}</p>
                </div>
                {i < 2 && <div className="hidden md:block w-[1px] h-[48px] bg-[var(--color-text)]" />}
              </div>
            ))}
          </div>

          {/* Trust cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[20px] md:gap-[var(--gap-cards)] lg:px-[95px]">
            {TRUST_CARDS.map((card) => (
              <div key={card.title} className="bg-[var(--color-bg-alt)] p-[28px] md:p-[40px]">
                <div className="flex items-center gap-[12px] mb-[var(--gap-tight)]">
                  <span className="text-[18px]">{card.icon}</span>
                  <span className="font-[var(--font-montaga)] text-[length:var(--text-subheading)] font-normal leading-[24px] text-[color:var(--color-text)]">{card.title}</span>
                </div>
                <p className="text-[14px] font-normal leading-[20px] text-[color:var(--color-text)]">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5: LEGAL DISCLAIMER ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto">
          <h2 className="font-[var(--font-montaga)] text-[28px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[33px] text-[color:var(--color-text)] mb-[20px] md:mb-[24px]">
            Regulatory &amp; Financial Disclosure
          </h2>
          <div className="bg-white p-[24px] md:p-[32px]">
            <p className="text-[14px] font-normal leading-[23px] text-[color:var(--color-text-secondary)]">
              EarlyInsider provides financial data and analysis for informational purposes. Not investment advice. Past insider trading patterns do not guarantee future results.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ CTA SECTION ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[896px] mx-auto text-center">
          <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[40px] text-[color:var(--color-text)] mb-[24px] md:mb-[32px]">
            Your signal pipeline starts here.
          </h2>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center h-[56px] md:h-[60px] px-[32px] md:px-[40px] bg-[var(--color-primary)] text-white text-[16px] md:text-[18px] font-semibold leading-[28px] hover:bg-[var(--color-primary-dark)] transition-colors shadow-[0px_2px_4px_rgba(0,0,0,0.1)]"
          >
            Start Monitoring Free
          </Link>
        </div>
      </section>
    </div>
  );
}
