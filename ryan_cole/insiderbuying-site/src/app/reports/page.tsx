"use client";

import Link from "next/link";
import { useState } from "react";

const TABS = ["All Reports", "Single Stock", "Bundles", "Sector Analysis", "Dividend"];

const CARD_CATEGORIES: Record<string, string> = {
  NVDA: "Single Stock",
  AAPL: "Single Stock",
  TSLA: "Single Stock",
  MSFT: "Single Stock",
  AMZN: "Single Stock",
  "S&P": "Bundles",
  AI: "Sector Analysis",
  DIV: "Dividend",
  HC: "Sector Analysis",
};

const FEATURED = {
  title: "Magnificent 7 Report",
  desc: "47 pages of deep-dive institutional analysis on the world\u2019s most influential technology leaders.",
  features: ["AAPL, MSFT, GOOG, AMZN analysis", "Insider buying patterns", "Financial health scoring", "Portfolio allocation models"],
  price: "$29.99",
  oldPrice: "$89.93",
};

const CARDS = [
  { ticker: "NVDA", label: "NVDA \u00b7 MONTAGA", title: "NVIDIA Deep Dive", pages: "25-page analysis", features: ["Insider buying history", "Financial breakdown", "Competitor analysis", "AI forecast model"], price: "$14.99" },
  { ticker: "AAPL", label: "AAPL \u00b7 MONTAGA", title: "Apple Ecosystem Value", pages: "32-page analysis", features: ["Services revenue deep-dive", "Hardware cycle analysis", "Insider conviction score", "Valuation framework"], price: "$14.99" },
  { ticker: "TSLA", label: "TSLA \u00b7 MONTAGA", title: "Tesla Full Self-Driving", pages: "28-page analysis", features: ["FSD revenue projections", "Energy business analysis", "Insider selling patterns", "Autonomous fleet model"], price: "$14.99" },
  { ticker: "MSFT", label: "MSFT \u00b7 MONTAGA", title: "Microsoft Cloud Edge", pages: "30-page analysis", features: ["Azure growth decomposition", "AI Copilot monetization", "Enterprise moat analysis", "Insider accumulation data"], price: "$14.99" },
  { ticker: "AMZN", label: "AMZN \u00b7 MONTAGA", title: "Amazon Logistics Alpha", pages: "24-page analysis", features: ["AWS margin analysis", "Logistics cost reduction", "Prime membership economics", "Insider transaction history"], price: "$14.99" },
  { ticker: "S&P", label: "INDEX \u00b7 BUNDLE", title: "S&P 500 Sector Weights", pages: "50-page bundle", features: ["All 11 sectors analyzed", "Insider flow aggregation", "Conviction scoring model", "Allocation framework"], price: "$24.99", highlight: true },
  { ticker: "AI", label: "SECTOR \u00b7 MONTAGA", title: "AI & Semi Sector Outlook", pages: "40-page analysis", features: ["Chip supply chain analysis", "Insider cluster detection", "Capex cycle forecasting", "Revenue growth modeling"], price: "$19.99" },
  { ticker: "DIV", label: "DIVIDEND \u00b7 MONTAGA", title: "Dividend Kings 2026", pages: "35-page analysis", features: ["Top 30 dividend aristocrats", "Payout sustainability scoring", "Insider buying correlation", "Yield-growth framework"], price: "$19.99" },
  { ticker: "HC", label: "TRENDS \u00b7 MONTAGA", title: "Healthcare Trends", pages: "26-page analysis", features: ["GLP-1 market dynamics", "Biotech insider activity", "Patent cliff analysis", "Demographic trend modeling"], price: "$14.99" },
];

const CHECK = <svg className="w-[11px] h-[8px] shrink-0" viewBox="0 0 11 8"><path d="M1 4l3 3L10 1" stroke="#006d34" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>;

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState("All Reports");
  const filteredCards = activeTab === "All Reports"
    ? CARDS
    : CARDS.filter((card) => CARD_CATEGORIES[card.ticker] === activeTab);

  return (
    <div className="bg-[var(--color-bg-alt)]">

      {/* ═══ SECTION 1: HEADER ═══ */}
      <section className="bg-[var(--color-bg-alt)] px-[20px] md:px-[48px] flex items-center min-h-[280px] md:min-h-[360px]">
        <div className="max-w-[1184px] mx-auto flex flex-col gap-[12px] md:gap-[15px] py-[64px] md:py-[80px]">
          <p className="text-[12px] font-semibold leading-[18px] text-[color:var(--color-text-secondary)] uppercase tracking-wider">Research</p>
          <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[54px] font-normal leading-[1.1] md:leading-[52px] text-[color:var(--color-text)]">Institutional-Grade Research. SEC Insider Data. AI-Synthesized Analysis.</h1>
          <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[29px] text-[color:var(--color-text-secondary)] max-w-[672px]">
            Deep dives on individual stocks, sectors, and dividend safety. Each report cross-references Form 4 filings with 94M+ indexed financial records. Every report includes an explicit verdict.
          </p>
        </div>
      </section>

      {/* ═══ SECTION 2: FILTER TABS ═══ */}
      <section className="bg-white pt-[24px] px-[20px] md:px-[48px] overflow-x-auto">
        <div className="max-w-[1184px] mx-auto border-b border-[var(--color-border)]">
          <div className="flex items-center gap-[var(--gap-items)] md:gap-[40px]">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-[13px] md:text-[14px] leading-[20px] pb-[16px] border-b-[1px] transition-colors whitespace-nowrap ${
                  activeTab === tab ? "font-bold text-[color:var(--color-text)] border-[var(--color-primary)]" : "font-normal text-[color:var(--color-text-secondary)] opacity-60 border-transparent hover:opacity-100"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 3: FEATURED REPORT ═══ */}
      <section className="pt-[48px] pb-[48px] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[48px]">
        <div className="max-w-[1184px] mx-auto relative">
          <span className="absolute top-[16px] left-[16px] z-10 bg-[#00d26a] text-white text-[11px] font-black leading-[15px] px-[12px] py-[4px] rounded-[2px]">BEST VALUE</span>
          <div className="bg-white border border-[var(--color-border-light)] flex flex-col md:flex-row gap-[var(--gap-items)] md:gap-[48px] p-[24px] md:p-[40px] items-center">
            <div className="w-full md:w-[302px] h-[280px] md:h-[403px] bg-[var(--color-border-light)] shrink-0" />
            <div className="flex flex-col justify-center flex-1">
              <p className="text-[12px] font-medium leading-[15px] text-[color:var(--color-text-secondary)] uppercase tracking-wider mb-[12px] md:mb-[var(--gap-tight)]">BUNDLE &middot; 7 STOCKS</p>
              <h2 className="font-[var(--font-montaga)] text-[28px] md:text-[32px] font-normal leading-[1.2] md:leading-[36px] text-[color:var(--color-text)] mb-[12px]">{FEATURED.title}</h2>
              <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[28px] text-[color:var(--color-text-secondary)] mb-[24px] md:mb-[32px]">{FEATURED.desc}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[var(--gap-items)] gap-y-[12px] mb-[28px] md:mb-[40px]">
                {FEATURED.features.map((f) => (
                  <div key={f} className="flex items-center gap-[12px]">
                    {CHECK}
                    <span className="text-[14px] font-normal leading-[20px] text-[color:var(--color-text)]">{f}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-baseline gap-[16px] mb-[24px] md:mb-[32px]">
                <span className="font-[var(--font-montaga)] text-[32px] md:text-[36px] font-normal leading-[40px] text-[color:var(--color-text)]">{FEATURED.price}</span>
                <span className="text-[16px] font-normal leading-[24px] text-[color:var(--color-text-muted)] line-through">{FEATURED.oldPrice}</span>
              </div>
              <Link href="/signup" className="inline-flex items-center justify-center w-full sm:w-[233px] h-[52px] bg-[var(--color-primary)] text-white text-[14px] font-medium leading-[20px] hover:bg-[var(--color-primary-dark)] transition-colors">
                Download Report
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4: REPORT GRID ═══ */}
      <section className="pb-[64px] md:pb-[96px] px-[20px] md:px-[48px]">
        <div className="max-w-[1184px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[20px] md:gap-[var(--gap-items)]">
          {filteredCards.map((card) => (
            <div key={card.ticker} className="bg-white shadow-[0px_1px_3px_rgba(0,0,0,0.06)] p-[24px] md:p-[32px] flex flex-col relative">
              <div className="flex items-center justify-between mb-[var(--gap-tight)]">
                <div className={`w-[44px] h-[44px] md:w-[48px] md:h-[48px] rounded-[2px] flex items-center justify-center text-[12px] font-bold ${
                  card.highlight ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-border-light)] text-[color:var(--color-text-secondary)] opacity-70"
                }`}>
                  {card.ticker.slice(0, 2)}
                </div>
                <span className="text-[12px] font-medium leading-[16px] text-[color:var(--color-text-secondary)]">{card.label}</span>
              </div>
              <h3 className="font-[var(--font-montaga)] text-[22px] md:text-[length:var(--text-heading)] font-normal leading-[28px] text-[color:var(--color-text)] mb-[4px]">{card.title}</h3>
              <p className="text-[12px] font-normal leading-[16px] text-[color:var(--color-text-secondary)] mb-[20px]">{card.pages}</p>
              <div className="flex flex-col gap-[12px] mb-[24px] flex-1">
                {card.features.map((f) => (
                  <div key={f} className="flex items-center gap-[8px]">
                    {CHECK}
                    <span className="text-[12px] font-normal leading-[16px] text-[color:var(--color-text-secondary)]">{f}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-[24px] border-t border-[var(--color-border-light)]">
                <span className="font-[var(--font-montaga)] text-[22px] md:text-[24px] font-bold leading-[32px] text-[color:var(--color-text)]">{card.price}</span>
                <Link
                  href="/signup"
                  className={`h-[34px] px-[16px] flex items-center justify-center text-[12px] font-bold leading-[16px] transition-colors ${
                    card.highlight
                      ? "bg-[var(--color-primary)] text-white border border-[var(--color-primary)]"
                      : "border border-[var(--color-primary)] text-[color:var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white"
                  }`}
                >
                  Download
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ SECTION 5: CUSTOM REPORT CTA ═══ */}
      <section className="bg-white pt-[48px] pb-[48px] md:pt-[60px] md:pb-[60px] px-[20px] md:px-[32px]">
        <div className="max-w-[672px] mx-auto text-center">
          <h2 className="font-[var(--font-montaga)] text-[30px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[42px] text-[color:var(--color-text)] mb-[var(--gap-tight)]">
            Need a Custom Report?
          </h2>
          <p className="text-[15px] md:text-[16px] font-normal leading-[24px] md:leading-[26px] text-[color:var(--color-text-secondary)] mb-[var(--gap-tight)]">
            Request analysis on any publicly traded company. Delivered within 24 hours by our institutional research desk.
          </p>
          <div className="flex flex-col items-center gap-[16px] pt-[16px]">
            <Link
              href="mailto:research@earlyinsider.com"
              className="inline-flex items-center justify-center h-[54px] px-[32px] md:px-[40px] border border-[var(--color-primary)] text-[14px] font-medium leading-[20px] text-[color:var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors w-full sm:w-auto"
            >
              Request Custom Report
            </Link>
            <p className="text-[14px] font-normal leading-[20px] text-[color:var(--color-text-secondary)] opacity-60">Starting at $29.99</p>
          </div>
        </div>
      </section>
    </div>
  );
}
