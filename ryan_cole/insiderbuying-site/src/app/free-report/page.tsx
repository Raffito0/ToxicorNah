"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const FEATURES = [
  "+23.4% avg. return vs. S&P 500 baseline",
  "68% win rate across 50,247 CEO purchases (12-month hold)",
  "7 filters that isolate high-conviction purchases from noise",
  "Decay curve: 25% of returns accrue in the first 5 days",
];

const CARDS = [
  { title: "The 23.4% Edge", desc: "CEO purchases outperformed the S&P 500 by 23.4% on average across 50,247 filings. Strongest in companies under $2B market cap. Breakdown by sector, cap decile, and insider role." },
  { title: "The 5-Day Window", desc: "Jeng, Metrick & Zeckhauser (Harvard/Wharton, 1999) found that 25% of abnormal returns materialize within 5 trading days. The report maps this decay curve and quantifies the cost of a 24-hour delay." },
  { title: "Noise vs. Signal", desc: "10b5-1 plans, option exercises, and small acquisitions account for 80% of filings. The report details the 7 filters that isolate high-conviction purchases from routine transactions." },
];

export default function FreeReportPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Section 5 CTA form state
  const [ctaEmail, setCtaEmail] = useState("");
  const [ctaSubmitted, setCtaSubmitted] = useState(false);
  const [ctaLoading, setCtaLoading] = useState(false);

  async function insertSubscriber(subscriberEmail: string, source: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("newsletter_subscribers")
      .insert({ email: subscriberEmail, source });
    // Duplicate email (unique constraint) — treat as success
    if (error && error.code === "23505") return null;
    return error;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const err = await insertSubscriber(email, "free_report");
    if (err) {
      setError("Something went wrong. Please try again.");
      setLoading(false);
      return;
    }
    setSubmitted(true);
    setLoading(false);
  }

  async function handleCtaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCtaLoading(true);
    const err = await insertSubscriber(ctaEmail, "free_report");
    if (!err) setCtaSubmitted(true);
    setCtaLoading(false);
  }

  return (
    <div className="bg-[var(--color-bg-alt)]">

      {/* ═══ SECTION 1: HERO ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[1216px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-[40px] lg:gap-[64px] items-start">

          {/* Left — Text content */}
          <div className="flex flex-col gap-[var(--gap-cards)] max-w-[576px]">
            <p className="text-[14px] font-bold leading-[20px] text-[color:var(--color-signal-green)] font-[var(--font-mono)]">FREE RESEARCH</p>
            <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[54px] font-normal leading-[1.1] md:leading-[60px] text-[color:var(--color-text)]">
              The CEO Alpha Report
            </h1>
            <p className="text-[18px] font-normal leading-[28px] text-[color:var(--color-primary)]">Updated March 2026</p>
            <p className="text-[18px] font-normal leading-[29px] text-[color:var(--color-text-secondary)]">
              We analyzed 50,247 CEO stock purchases filed with the SEC. The pattern held every year for a decade. Free 14-page report. 10 years of Form 4 data (2015-2025).
            </p>
            <ul className="flex flex-col gap-[16px]">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-[12px]">
                  <svg className="w-[20px] h-[20px] shrink-0" viewBox="0 0 20 20" fill="#006d34"><circle cx="10" cy="10" r="10"/><path d="M6 10l3 3 5-5" stroke="white" strokeWidth="2" fill="none"/></svg>
                  <span className="text-[16px] font-medium leading-[24px] text-[color:var(--color-text)]">{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right — Report preview card */}
          <div className="flex flex-col items-center gap-[-11px]">
            <div className="w-full max-w-[478px] bg-white rounded-[2px] border border-[var(--color-primary)] shadow-[0px_4px_24px_rgba(0,0,0,0.08)] p-[16px]">
              {/* Report mockup interior */}
              <div className="flex flex-col gap-[var(--gap-items)] p-[16px]">
                {/* Top bar */}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold font-[var(--font-mono)] text-[color:var(--color-primary)] uppercase tracking-wider">EarlyInsider</span>
                  <span className="text-[11px] font-normal text-[color:var(--color-text-muted)]">March 2026</span>
                </div>
                {/* Title */}
                <div className="pt-[32px]">
                  <h2 className="font-[var(--font-montaga)] text-[28px] font-normal leading-[32px] text-[color:var(--color-text)]">
                    The Insider Alpha<br />Strategy
                  </h2>
                </div>
                <div className="w-[48px] h-[6px] bg-[#006d34] rounded-full" />
                {/* Description */}
                <p className="text-[13px] font-normal leading-[20px] text-[color:var(--color-text-secondary)]">
                  Proprietary backtest analysis of 50,000+ SEC Form 4 filings. CEO buying signals vs S&P 500 benchmark.
                </p>
              </div>
              {/* Chart mockup */}
              <div className="bg-white p-[8px] mt-[16px]">
                <div className="flex items-end justify-center gap-[8px] h-[117px]">
                  {[40, 65, 30, 55, 75, 45, 60, 35, 70, 50].map((h, i) => (
                    <div key={i} className="w-[28px] bg-[var(--color-primary)] rounded-t-[2px]" style={{ height: `${h}px` }} />
                  ))}
                </div>
              </div>
              {/* Footer stats */}
              <div className="flex items-center justify-between pt-[16px] mt-[16px] border-t border-[var(--color-border-light)]">
                <div>
                  <p className="text-[18px] font-bold leading-[24px] text-[color:var(--color-signal-green)] font-[var(--font-mono)]">+23.4%</p>
                  <p className="text-[11px] font-normal leading-[14px] text-[color:var(--color-text-muted)]">Avg. Signal Return</p>
                </div>
                <div className="text-right">
                  <p className="text-[18px] font-bold leading-[24px] text-[color:var(--color-text)] font-[var(--font-mono)]">68%</p>
                  <p className="text-[11px] font-normal leading-[14px] text-[color:var(--color-text-muted)]">Win Rate (12mo)</p>
                </div>
              </div>
            </div>
            <p className="text-[14px] font-light leading-[16px] text-[color:var(--color-text-secondary)] text-center pt-[48px]">
              12-14 pages &middot; Updated monthly &middot; Free forever
            </p>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 2: EMAIL CAPTURE ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[500px] mx-auto text-center">
          {submitted ? (
            <div className="py-[32px]">
              <div className="w-[56px] h-[56px] rounded-full bg-[#006d34]/10 flex items-center justify-center mx-auto mb-[var(--gap-tight)]">
                <svg className="w-[24px] h-[24px]" viewBox="0 0 24 24" fill="#006d34"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              </div>
              <h2 className="font-[var(--font-montaga)] text-[length:var(--text-title)] font-normal leading-[36px] text-[color:var(--color-text)] mb-[12px]">Check your email!</h2>
              <p className="text-[16px] font-normal leading-[24px] text-[color:var(--color-text-secondary)]">We sent the report to <strong>{email}</strong></p>
            </div>
          ) : (
            <>
              <h2 className="font-[var(--font-montaga)] text-[length:var(--text-title)] font-normal leading-[36px] text-[color:var(--color-text)] mb-[12px]">
                Get the Report
              </h2>
              <p className="text-[16px] font-normal leading-[24px] text-[color:var(--color-text-secondary)] mb-[32px]">
                Enter your email and we&apos;ll send it instantly.
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="institutional@firm.com"
                  className="w-full h-[55px] px-[24px] bg-white text-[16px] font-normal leading-[19px] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[52px] bg-[#006d34] text-white text-[14px] font-bold leading-[20px] hover:bg-[#005c28] transition-colors disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Download Free Report"}
                </button>
                {error && (
                  <p className="text-[12px] font-normal leading-[15px] text-red-600">{error}</p>
                )}
                <p className="text-[12px] font-normal leading-[15px] text-[color:var(--color-text-muted)]">
                  By clicking download, you agree to our Terms of Service and Privacy Policy.
                </p>
              </form>
            </>
          )}
        </div>
      </section>

      {/* ═══ SECTION 3: WHAT YOU'LL LEARN ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[32px]">
        <div className="max-w-[980px] mx-auto">
          <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[40px] text-[color:var(--color-text)] mb-[40px] md:mb-[80px]">
            What You&apos;ll Learn
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[20px] md:gap-[var(--gap-cards)]">
            {CARDS.map((card) => (
              <div key={card.title} className="bg-white border-[0px] border-black/0 p-[40px]">
                <div className="w-full h-[28px] bg-[var(--color-primary)] rounded-[2px] opacity-30 mb-[24px]" />
                <h3 className="font-[var(--font-montaga)] text-[20px] font-bold leading-[28px] text-[color:var(--color-text)] mb-[24px]">{card.title}</h3>
                <p className="text-[16px] font-normal leading-[26px] text-[color:var(--color-text-secondary)]">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4: SOCIAL PROOF BAR ═══ */}
      <section className="bg-white border-y border-[var(--color-border-light)] py-[48px] px-[32px]">
        <p className="text-[12px] font-normal leading-[16px] text-[color:var(--color-text-muted)] font-[var(--font-mono)] text-center">
          Powered by real SEC Form 4 data &middot; Updated monthly &middot; 100% free
        </p>
      </section>

      {/* ═══ SECTION 5: FINAL CTA ═══ */}
      <section className="bg-[var(--color-navy)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px] relative overflow-hidden">
        {/* Abstract bg */}
        <div className="absolute left-0 top-0 bottom-0 w-[426px] opacity-10 bg-gradient-to-r from-white/20 to-transparent" />

        <div className="relative max-w-[896px] mx-auto text-center">
          <h2 className="font-[var(--font-montaga)] text-[30px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[48px] text-white mb-[var(--gap-tight)]">
            Don&apos;t invest blind.
          </h2>
          <p className="text-[16px] md:text-[20px] font-normal leading-[26px] md:leading-[28px] text-white mb-[32px] md:mb-[48px]">
            See what executives are buying with their own money.
          </p>
          {ctaSubmitted ? (
            <p className="text-[16px] font-normal leading-[24px] text-white">Check your email at <strong>{ctaEmail}</strong> for the report!</p>
          ) : (
            <form onSubmit={handleCtaSubmit} className="flex flex-col sm:flex-row gap-[12px] sm:gap-[16px] max-w-[672px] mx-auto w-full">
              <input
                type="email"
                required
                value={ctaEmail}
                onChange={(e) => setCtaEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full sm:flex-1 sm:min-w-0 h-[52px] md:h-[56px] px-[20px] md:px-[24px] bg-white text-[16px] font-normal leading-[19px] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-muted)]"
              />
              <button
                type="submit"
                disabled={ctaLoading}
                className="h-[52px] md:h-[56px] px-[28px] md:px-[40px] bg-[#006d34] text-[15px] md:text-[16px] font-bold leading-[24px] text-white hover:bg-[#005c28] transition-colors shrink-0 whitespace-nowrap disabled:opacity-50"
              >
                {ctaLoading ? "Sending..." : "Access Report"}
              </button>
            </form>
          )}
          <p className="text-[12px] font-normal leading-[15px] text-white/60 mt-[16px]">
            Institutional Grade Intelligence
          </p>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      {/* Footer is rendered globally from layout.tsx */}
    </div>
  );
}
