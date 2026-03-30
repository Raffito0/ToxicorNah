import type { Metadata } from "next";
import Link from "next/link";
import { EmailCapture } from "@/components/EmailCapture";

export const metadata: Metadata = {
  title: "How It Works | EarlyInsider",
  description:
    "See how EarlyInsider monitors SEC Form 4 filings in real time, applies AI analysis, and delivers high-conviction insider buying alerts to your inbox.",
};

/* ── Data ── */

const PIPELINE_CARDS = [
  {
    iconBg: "#e0e0ff",
    iconColor: "#000592",
    title: "Data Acquisition",
    desc: "We pull raw SEC Form 4, 13D, and 13G filings directly from the EDGAR database via low-latency API. Our system monitors thousands of tickers 24/7.",
  },
  {
    iconBg: "#62ff95",
    iconColor: "#006d34",
    title: "AI-Powered Filtering",
    desc: "Our proprietary AI filters out routine option exercises, tax-related sales, and automated 10b5-1 plans. We only alert you to genuine, open-market conviction buys.",
  },
  {
    iconBg: "#ffdad6",
    iconColor: "#5a0006",
    title: "Institutional Analysis",
    desc: "Every significant trade is cross-referenced with 10 years of historical insider behavior, company financials, and current market context.",
  },
];

const CHECKLIST = [
  "Instant Email Alerts",
  "Mobile Push Notifications",
  "Direct Webhook Support (API)",
  "Historical Context Included",
];

const TECH_BLOCKS = [
  {
    tag: "V2.4",
    title: "SEC EDGAR Feed",
    rows: [
      { label: "SOURCE", value: "EDGAR-API.GOV" },
      { label: "THROUGHPUT", value: "1.2GB/SEC" },
      { label: "LATENCY", value: "~150MS" },
    ],
  },
  {
    tag: "LLM",
    title: "Conviction Engine",
    rows: [
      { label: "ENGINE", value: "PROPRIETARY" },
      { label: "FACTORS", value: "7-WEIGHTED" },
      { label: "BIAS-CAL", value: "ACTIVE" },
    ],
  },
  {
    tag: "HIST",
    title: "Backtesting Engine",
    rows: [
      { label: "DATA RANGE", value: "2014 - 2024" },
      { label: "INDEXED", value: "94M RECORDS" },
      { label: "STORAGE", value: "PARQUET/S3" },
    ],
  },
  {
    tag: "SEC",
    title: "Infrastructure",
    rows: [
      { label: "ENCRYPTION", value: "AES-256-GCM" },
      { label: "PAYMENTS", value: "STRIPE-RSA" },
      { label: "UPTIME", value: "99.99% SLA" },
    ],
  },
];

const BACKTEST_LIST = [
  "10+ years of Form 4 history",
  "Sector-specific hit rates",
  "Conviction-weighted results",
];

const TIMELINE_STEPS = [
  { time: "0S", title: "SEC Filing", sub: "Event Published", active: true, final: false },
  { time: "+12S", title: "Data Parsing", sub: "Extraction Engine", active: false, final: false },
  { time: "+28S", title: "AI Scoring", sub: "Conviction Model", active: false, final: false },
  { time: "+45S", title: "Alert Sent", sub: "Email/Push API", active: false, final: false },
  { time: "+60S", title: "User Inbox", sub: "Live Opportunity", active: false, final: true },
];

const DATA_LABELS = [
  { label: "Mean Latency", value: "0.82s" },
  { label: "Node Distribution", value: "US-EAST-1" },
  { label: "Uptime", value: "99.998%" },
];

/* ── Icons (SVG) ── */

function RadarIcon({ color }: { color: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.07 4.93A10 10 0 0 0 12 2a10 10 0 0 0-7.07 2.93" />
      <path d="M15.54 8.46A5 5 0 0 0 12 7a5 5 0 0 0-3.54 1.46" />
      <circle cx="12" cy="12" r="1" fill={color} />
    </svg>
  );
}

function FilterIcon({ color }: { color: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={color}>
      <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
    </svg>
  );
}

function AnalyticsIcon({ color }: { color: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill={color}>
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="#006d34">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

function TechIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="#000592">
      <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
    </svg>
  );
}

const CARD_ICONS = [RadarIcon, FilterIcon, AnalyticsIcon];

/* ── Timeline Step Icons ── */

function FilingIcon({ color }: { color: string }) {
  return (
    <svg width="15" height="19" viewBox="0 0 24 24" fill={color}>
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
    </svg>
  );
}

function ParseIcon({ color }: { color: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill={color}>
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z" />
    </svg>
  );
}

function ScoringIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="19" viewBox="0 0 24 24" fill={color}>
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
    </svg>
  );
}

function AlertIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="18" viewBox="0 0 24 24" fill={color}>
      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
    </svg>
  );
}

function InboxIcon({ color }: { color: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill={color}>
      <path d="M19 3H4.99c-1.11 0-1.98.89-1.98 2L3 19c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z" />
    </svg>
  );
}

const STEP_ICONS = [FilingIcon, ParseIcon, ScoringIcon, AlertIcon, InboxIcon];

/* ── Page Component ── */

export default function HowItWorksPage() {
  return (
    <div className="bg-[var(--color-bg-alt)]">

      {/* ═══ SECTION 1: HEADER ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] px-[20px] md:px-[72px]">
        <div className="max-w-[1136px] mx-auto flex flex-col gap-[16px]">
          <p className="text-[12px] font-semibold leading-[18px] tracking-[2px] text-[color:var(--color-text-secondary)] uppercase">
            PROCESS &amp; TECHNOLOGY
          </p>
          <h1 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-display)] font-normal leading-[1.26] text-[color:var(--color-text)]">
            150,000+ Form 4 Filings Per Year. Most Investors See Them Late.
          </h1>
          <p className="text-[16px] md:text-[18px] font-normal leading-[29px] text-[color:var(--color-text-secondary)] max-w-[672px]">
            The SEC publishes insider trading disclosures on EDGAR within hours of the transaction. The data is public. The volume is unmanageable. And 80% of filings are routine noise. The 20% that represent genuine conviction buying are buried in the same feed.
          </p>
        </div>
      </section>

      {/* ═══ SECTION 2: THE DATA PIPELINE ═══ */}
      <section className="bg-white py-[var(--section-y-mobile)] md:py-[var(--section-y)] px-[20px] md:px-[40px]">
        <div className="max-w-[1200px] mx-auto px-[0px] md:px-[32px]">
          <h2 className="font-[var(--font-montaga)] text-[28px] md:text-[length:var(--text-title)] font-normal leading-[42px] text-[color:var(--color-text)] text-center mb-[40px] md:mb-[64px]">
            The Data Pipeline
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[20px] md:gap-[32px]">
            {PIPELINE_CARDS.map((card, i) => {
              const Icon = CARD_ICONS[i];
              return (
                <div
                  key={card.title}
                  className="bg-[var(--color-bg-alt)] p-[28px] md:p-[44px] md:pb-[70px] flex flex-col gap-[24px]"
                >
                  <div
                    className="w-[48px] h-[48px] flex items-center justify-center"
                    style={{ backgroundColor: card.iconBg }}
                  >
                    <Icon color={card.iconColor} />
                  </div>
                  <h3 className="text-[20px] font-bold leading-[28px] text-[color:var(--color-text)]">
                    {card.title}
                  </h3>
                  <p className="text-[16px] font-normal leading-[26px] text-[color:var(--color-text-secondary)]">
                    {card.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 3: INSTANT DELIVERY ═══ */}
      <section className="bg-white py-[var(--section-y-mobile)] md:py-[var(--section-y)] px-[20px] md:px-[72px]">
        <div className="max-w-[1136px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-[40px] lg:gap-[80px] items-center">
          {/* Left: Text + Checklist */}
          <div className="flex flex-col gap-[32px]">
            <h2 className="font-[var(--font-montaga)] text-[28px] md:text-[length:var(--text-title)] font-normal leading-[42px] text-[color:var(--color-text)]">
              Instant Delivery
            </h2>
            <p className="text-[18px] font-normal leading-[29px] text-[color:var(--color-text-secondary)]">
              When a high-conviction trade is detected, our system generates a comprehensive alert and sends it via email and push notification within 60 seconds of the filing&apos;s publication. Most competitors have a 24-hour delay &mdash; we don&apos;t.
            </p>
            <ul className="flex flex-col gap-[16px]">
              {CHECKLIST.map((item) => (
                <li key={item} className="flex items-center gap-[12px]">
                  <CheckCircleIcon />
                  <span className="text-[16px] font-medium leading-[24px] text-[color:var(--color-text)]">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: Mock Alert Card */}
          <div className="bg-white border border-[#070707]/10 shadow-[0px_20px_40px_rgba(0,0,0,0.06)] p-[24px] md:p-[32px] flex flex-col gap-[32px]">
            {/* Alert Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[16px]">
                <div className="w-[40px] h-[40px] rounded-[12px] bg-[#e0e0ff] flex items-center justify-center">
                  <span className="font-[var(--font-mono)] text-[16px] font-bold text-[color:var(--color-primary)]">TSLA</span>
                </div>
                <div>
                  <p className="text-[18px] font-bold leading-[28px] text-[color:var(--color-text)]">Tesla, Inc.</p>
                  <p className="font-[var(--font-mono)] text-[12px] font-normal leading-[16px] tracking-[1.2px] text-[color:var(--color-text-secondary)]">NAS: TSLA</p>
                </div>
              </div>
              <span className="font-[var(--font-mono)] text-[11px] font-bold leading-[15px] text-[#005226] bg-[#54fd8f] px-[8px] py-[4px] rounded-[2px] shrink-0">
                High Conviction
              </span>
            </div>

            {/* Alert Details */}
            <div className="flex flex-col gap-[24px]">
              {/* Insider / Transaction row */}
              <div className="flex justify-between items-end pb-[16px] border-b border-[var(--color-border-light)]">
                <div className="flex flex-col gap-[4px]">
                  <span className="font-[var(--font-mono)] text-[12px] font-normal leading-[16px] text-[color:var(--color-text-secondary)]">Insider</span>
                  <span className="text-[16px] font-bold leading-[24px] text-[color:var(--color-text)]">Kimbal Musk</span>
                </div>
                <div className="flex flex-col gap-[4px] items-end">
                  <span className="font-[var(--font-mono)] text-[12px] font-normal leading-[16px] text-[color:var(--color-text-secondary)]">Transaction</span>
                  <span className="text-[16px] font-bold leading-[24px] text-[color:var(--color-signal-green)]">Buy (Open Market)</span>
                </div>
              </div>

              {/* Amount / Price row */}
              <div className="flex justify-between items-end pb-[16px] border-b border-[var(--color-border-light)]">
                <div className="flex flex-col gap-[4px]">
                  <span className="font-[var(--font-mono)] text-[12px] font-normal leading-[16px] text-[color:var(--color-text-secondary)]">Amount</span>
                  <span className="font-[var(--font-mono)] text-[20px] font-normal leading-[24px] text-[color:var(--color-text)]">$2,450,000</span>
                </div>
                <div className="flex flex-col gap-[4px] items-end">
                  <span className="font-[var(--font-mono)] text-[12px] font-normal leading-[16px] text-[color:var(--color-text-secondary)]">Avg. Price</span>
                  <span className="font-[var(--font-mono)] text-[20px] font-normal leading-[24px] text-[color:var(--color-text)]">$168.42</span>
                </div>
              </div>

              {/* Alert timestamp */}
              <p className="font-[var(--font-mono)] text-[12px] font-semibold leading-[16px] text-[color:var(--color-primary)] text-center">
                Alert sent: 0s after filing
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4: THE TECHNOLOGY STACK ═══ */}
      <section className="bg-[var(--color-bg-alt)] py-[var(--section-y-mobile)] md:py-[var(--section-y)] px-[20px] md:px-[40px]">
        <div className="max-w-[1200px] mx-auto px-[0px] md:px-[32px]">
          <h2 className="font-[var(--font-montaga)] text-[28px] md:text-[length:var(--text-title)] font-normal leading-[48px] text-[color:var(--color-text)] text-center mb-[48px] md:mb-[80px]">
            The Technology Stack
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px] md:gap-[24px]">
            {TECH_BLOCKS.map((block) => (
              <div
                key={block.tag}
                className="bg-white border border-[var(--color-border)] p-[24px] md:p-[33px] flex flex-col gap-[24px]"
              >
                {/* Tag row */}
                <div className="flex items-center justify-between">
                  <TechIcon />
                  <span className="font-[var(--font-mono)] text-[11px] font-normal text-[color:var(--color-primary)] bg-[#e0e0ff] px-[8px] py-[2px] rounded-[2px]">
                    {block.tag}
                  </span>
                </div>
                {/* Title */}
                <h4 className="text-[length:var(--text-subheading)] font-bold leading-[28px] text-[color:var(--color-text)]">
                  {block.title}
                </h4>
                {/* Data rows */}
                <div className="flex flex-col gap-[8px]">
                  {block.rows.map((row, ri) => (
                    <div
                      key={row.label}
                      className={`flex justify-between items-center ${ri < block.rows.length - 1 ? "pb-[4px] border-b border-[var(--color-border)]" : ""}`}
                    >
                      <span className="font-[var(--font-mono)] text-[12px] font-normal text-[color:var(--color-text-secondary)]">
                        {row.label}
                      </span>
                      <span className="font-[var(--font-mono)] text-[12px] font-bold text-[color:var(--color-text)]">
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5: STRATEGIC BACKTESTING ═══ */}
      <section className="bg-white py-[var(--section-y-mobile)] md:py-[var(--section-y)] px-[20px] md:px-[72px]">
        <div className="max-w-[1136px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-[40px] lg:gap-[80px] items-start">
          {/* Left: Text + List */}
          <div className="flex flex-col gap-[24px]">
            <p className="text-[12px] font-bold leading-[17px] tracking-[1px] text-[color:var(--color-text-muted)] uppercase">
              VALIDATION
            </p>
            <h2 className="font-[var(--font-montaga)] text-[28px] md:text-[length:var(--text-title)] font-normal leading-[1.25] text-[color:var(--color-text)]">
              Institutional-Grade Backtesting
            </h2>
            <p className="text-[18px] font-normal leading-[29px] text-[color:var(--color-text-secondary)]">
              We don&apos;t just deliver alerts; we validate them against a decade of historical performance.
            </p>
            <ul className="flex flex-col gap-[16px] pt-[8px]">
              {BACKTEST_LIST.map((item) => (
                <li key={item} className="flex items-center gap-[12px]">
                  <CheckCircleIcon />
                  <span className="text-[16px] font-medium leading-[24px] text-[color:var(--color-text-secondary)]">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: Chart Mockup */}
          <div className="bg-[var(--color-bg-alt)] border border-[var(--color-border)] p-[28px] md:p-[40px] flex flex-col gap-[32px]">
            {/* Chart header */}
            <div className="flex items-center justify-between">
              <span className="font-[var(--font-mono)] text-[11px] font-normal text-[color:var(--color-text-secondary)]">
                Performance Analysis: $NVDA
              </span>
              <div className="flex items-center gap-[16px]">
                <span className="font-[var(--font-mono)] text-[11px] font-semibold text-[color:var(--color-text)]">Price</span>
                <span className="font-[var(--font-mono)] text-[11px] font-semibold text-[color:var(--color-text)]">Buy Signal</span>
              </div>
            </div>

            {/* Chart area (simplified SVG representation) */}
            <div className="relative h-[200px] w-full">
              <svg className="w-full h-full" viewBox="0 0 446 200" fill="none" preserveAspectRatio="none">
                {/* Grid lines */}
                <line x1="0" y1="50" x2="446" y2="50" stroke="#e5e2e1" strokeWidth="0.5" />
                <line x1="0" y1="100" x2="446" y2="100" stroke="#e5e2e1" strokeWidth="0.5" />
                <line x1="0" y1="150" x2="446" y2="150" stroke="#e5e2e1" strokeWidth="0.5" />

                {/* Price line (rising trend) */}
                <path
                  d="M0 170 Q50 160 100 150 T200 120 T300 80 T400 30 L446 20"
                  stroke="#000592"
                  strokeWidth="2"
                  fill="none"
                />

                {/* Buy signal marker */}
                <circle cx="180" cy="130" r="6" fill="#006d34" stroke="white" strokeWidth="2" />

                {/* Alert label */}
                <rect x="150" y="108" width="60" height="14" rx="2" fill="#006d34" />
                <text x="155" y="118" fill="white" fontSize="8" fontWeight="700" fontFamily="Space Mono, monospace">ALERT: BUY</text>
              </svg>
            </div>

            {/* Time axis */}
            <div className="flex justify-between pt-[16px] border-t border-[var(--color-border)]">
              <span className="font-[var(--font-mono)] text-[11px] font-normal text-[color:var(--color-text-secondary)]">T-12M</span>
              <span className="font-[var(--font-mono)] text-[11px] font-normal text-[color:var(--color-text-secondary)]">T-6M</span>
              <span className="font-[var(--font-mono)] text-[11px] font-normal text-[color:var(--color-text-secondary)]">TODAY</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 6: THE 60-SECOND JOURNEY ═══ */}
      <section className="bg-[var(--color-bg-alt)] py-[var(--section-y-hero-mobile)] md:py-[var(--section-y-hero)] px-[20px] md:px-[40px] border-t border-[var(--color-border)]">
        <div className="max-w-[1200px] mx-auto">
          {/* Header */}
          <div className="flex flex-col items-center mb-[48px] md:mb-[64px]">
            <p className="text-[12px] font-bold tracking-[1px] text-[color:var(--color-primary)] uppercase mb-[16px]">
              NETWORK PERFORMANCE
            </p>
            <h2 className="font-[var(--font-montaga)] text-[28px] md:text-[length:var(--text-title)] font-normal leading-[54px] text-[color:var(--color-text)] text-center">
              The 60-Second Journey
            </h2>
            <p className="text-[16px] font-normal leading-[24px] text-[color:var(--color-text-secondary)] max-w-[576px] text-center mt-[16px]">
              Our low-latency infrastructure processes institutional filings faster than retail terminals can refresh.
            </p>
          </div>

          {/* Timeline */}
          <div className="max-w-[1024px] mx-auto mb-[32px] md:mb-[48px]">
            {/* Desktop: horizontal timeline */}
            <div className="hidden md:block relative">
              {/* Steps */}
              <div className="relative z-10 grid grid-cols-5 gap-0">
                {/* Line — centered on icons (36px = half of 72px icon height) */}
                <div className="absolute left-[10%] right-[10%] top-[36px] -translate-y-1/2 h-[2px] bg-gradient-to-r from-[#000592] via-[#c6c5d9] to-[#006d34] z-0" />
                {TIMELINE_STEPS.map((step, i) => {
                  const Icon = STEP_ICONS[i];
                  const isFirst = step.active;
                  const isFinal = step.final;
                  return (
                    <div key={step.time} className="flex flex-col items-center">
                      {/* Node */}
                      <div
                        className={`w-[72px] h-[72px] flex items-center justify-center relative ${
                          isFinal
                            ? "bg-[var(--color-signal-green)]"
                            : "bg-white"
                        } ${
                          isFirst
                            ? "border-2 border-[var(--color-primary)] shadow-[0px_4px_12px_rgba(0,5,146,0.15)]"
                            : isFinal
                              ? "shadow-[0px_4px_12px_rgba(0,109,52,0.2)]"
                              : "border border-[var(--color-border)] shadow-[0px_2px_8px_rgba(0,0,0,0.06)]"
                        }`}
                      >
                        <Icon color={isFinal ? "#ffffff" : isFirst ? "#000592" : "#454556"} />
                        {/* Time badge */}
                        <span
                          className={`absolute -bottom-[6px] font-[var(--font-mono)] text-[11px] font-bold px-[4px] py-[1px] rounded-[2px] ${
                            isFirst
                              ? "bg-[var(--color-primary)] text-white"
                              : isFinal
                                ? "bg-[#005226] text-white"
                                : "bg-[var(--color-border)] text-[color:var(--color-text-secondary)]"
                          }`}
                        >
                          {step.time}
                        </span>
                      </div>

                      {/* Label */}
                      <div className="mt-[24px] text-center">
                        <p className="text-[16px] font-bold leading-[22px] text-[color:var(--color-text)]">{step.title}</p>
                        <p className={`font-[var(--font-mono)] text-[13px] font-normal mt-[4px] ${isFinal ? "text-[color:var(--color-signal-green)] font-bold" : "text-[color:var(--color-text-secondary)]"}`}>
                          {step.sub}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile: vertical timeline */}
            <div className="md:hidden">
              <div className="relative pl-[56px] max-w-[320px] mx-auto">
                {/* Vertical line */}
                <div className="absolute left-[26px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-[#000592] via-[#c6c5d9] to-[#006d34]" />

                <div className="flex flex-col gap-[32px]">
                  {TIMELINE_STEPS.map((step, i) => {
                    const Icon = STEP_ICONS[i];
                    const isFirst = step.active;
                    const isFinal = step.final;
                    return (
                      <div key={step.time} className="flex items-start gap-[20px]">
                        {/* Node */}
                        <div
                          className={`absolute left-[8px] w-[38px] h-[38px] flex items-center justify-center shrink-0 ${
                            isFinal ? "bg-[var(--color-signal-green)]" : "bg-white"
                          } ${
                            isFirst
                              ? "border-2 border-[var(--color-primary)]"
                              : isFinal
                                ? ""
                                : "border border-[var(--color-border)]"
                          }`}
                        >
                          <Icon color={isFinal ? "#ffffff" : isFirst ? "#000592" : "#454556"} />
                        </div>
                        {/* Text */}
                        <div>
                          <span className={`font-[var(--font-mono)] text-[12px] font-bold ${isFirst ? "text-[color:var(--color-primary)]" : isFinal ? "text-[color:var(--color-signal-green)]" : "text-[color:var(--color-text-secondary)]"}`}>
                            {step.time}
                          </span>
                          <p className="text-[15px] font-bold leading-[22px] text-[color:var(--color-text)]">{step.title}</p>
                          <p className={`font-[var(--font-mono)] text-[13px] ${isFinal ? "text-[color:var(--color-signal-green)] font-bold" : "text-[color:var(--color-text-secondary)]"}`}>
                            {step.sub}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Data Labels */}
          <div className="max-w-[896px] mx-auto flex flex-col sm:flex-row justify-center gap-[32px] sm:gap-[64px] pt-[32px] border-t border-[var(--color-border)]">
            {DATA_LABELS.map((dl) => (
              <div key={dl.label} className="flex flex-col items-center sm:items-start gap-[4px]">
                <span className="font-[var(--font-mono)] text-[13px] font-normal text-[color:var(--color-text-secondary)]">{dl.label}</span>
                <span className="font-[var(--font-mono)] text-[22px] font-bold text-[color:var(--color-primary)]">{dl.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 7: FINAL CTA ═══ */}
      <section className="relative bg-[var(--color-primary)] py-[var(--section-y-mobile)] md:py-[var(--section-y)] px-[20px] md:px-[40px] overflow-hidden">
        {/* Radial gradient overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(57,68,239,0.4)_0%,transparent_70%)]" />

        <div className="relative max-w-[1200px] mx-auto px-[0px] md:px-[32px] flex flex-col md:flex-row items-center justify-between gap-[32px]">
          <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.5] text-white text-center md:text-left">
            The Data Is Public. The Speed Is Not.
          </h2>
          <Link
            href="/signup"
            className="bg-white text-black text-[18px] font-medium leading-[28px] px-[40px] py-[16px] hover:bg-gray-100 active:scale-[0.98] transition-all duration-150 shrink-0"
          >
            Start Monitoring Free
          </Link>
        </div>
      </section>

      {/* ═══ NEWSLETTER CAPTURE ═══ */}
      <section className="w-full py-[48px] bg-[var(--color-bg-alt)] border-t border-[var(--color-border)]">
        <div className="max-w-[540px] mx-auto px-[20px] text-center">
          <EmailCapture
            heading="See the Output"
            subheading="Want to see what the system produces? The CEO Alpha Report applies everything described on this page to real insider trades. Free."
            ctaText="Get the Free Report"
            placement="how_it_works"
          />
        </div>
      </section>
    </div>
  );
}
