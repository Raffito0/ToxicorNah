"use client";

import Link from "next/link";
import { useState } from "react";
import { EmailCapture } from "@/components/EmailCapture";

/* ── ALERT DATA ─────────────────────────────────────────── */
const ALERTS = [
  { name: "Jensen Huang", title: "CEO", ticker: "NVDA", amount: "+$4,240,000", time: "2m ago" },
  { name: "Tim Cook", title: "CEO", ticker: "AAPL", amount: "+$2,710,000", time: "14m ago" },
  { name: "Satya Nadella", title: "CEO", ticker: "MSFT", amount: "+$1,420,000", time: "41m ago" },
  { name: "Andy Jassy", title: "CEO", ticker: "AMZN", amount: "+$1,100,000", time: "1h ago" },
  { name: "Mark Zuckerberg", title: "CEO", ticker: "META", amount: "+$3,830,000", time: "2h ago" },
];

const STATS = [
  { value: "10.2%", label: "Annual Outperformance", desc: "Corporate insider purchase portfolios outperformed the market by 10.2% per year over the study period.", source: "Source: Jeng, Metrick & Zeckhauser, Harvard/Wharton, 1999" },
  { value: "25%", label: "Returns in First 5 Days", desc: "One quarter of abnormal returns following insider purchases accrue within the first 5 trading days of the filing. Speed of delivery is not a feature \u2014 it is the thesis.", source: "Source: Jeng, Metrick & Zeckhauser, Harvard/Wharton, 1999" },
  { value: "60%", label: "Predictive of 1-Year Returns", desc: "Aggregate insider trading activity predicts up to 60% of variation in one-year-ahead market returns.", source: "Source: Seyhun, Journal of Law and Economics, 1992" },
];

const REPORTS = [
  { label: "NVDA", title: "NVIDIA Deep Dive", pages: "25-page analysis", features: ["Insider buying history (12 months)", "Financial health breakdown", "Competitor comparison", "AI-powered forecast"], price: "$14" },
  { label: "BUNDLE", title: "Magnificent 7 Report", pages: "47-page complete analysis", features: ["All 7 tech giants analyzed", "Side-by-side comparison tables", "Sector-wide insider sentiment", "Portfolio allocation signals"], price: "$29", best: true },
  { label: "INCOME", title: "Dividend Kings 2026", pages: "30 stocks analyzed", features: ["Top 30 dividend aristocrats", "Yield vs growth analysis", "Insider buying patterns", "Monthly income projections"], price: "$24" },
];

const PLANS = [
  { name: "Free", desc: "Start monitoring.", priceAnnual: "$0", priceMonthly: "$0", features: ["Delayed Form 4 feed (15-minute lag)", "5 watchlist tickers", "Weekly insider digest email", "Basic filing data", "Access to CEO Alpha Report"], border: "", btn: "border border-[var(--color-border)] text-[color:var(--color-text)]", iconType: "check" as const },
  { name: "Analyst", desc: "See what the data means.", priceAnnual: "$24", priceMonthly: "$29", features: ["Real-time Form 4 alerts (under 60 seconds)", "AI conviction scoring on every filing", "Plain-English analysis per transaction", "25 watchlist tickers with custom filters", "Weekly AI summary with sector patterns", "1 Deep Dive report per month", "Email and Slack delivery"], border: "border border-[var(--color-primary)]", btn: "bg-[var(--color-primary)] text-white", popular: true, iconType: "badge" as const },
  { name: "Investor", desc: "The complete research desk.", priceAnnual: "$84", priceMonthly: "$99", features: ["Everything in Analyst", "Unlimited Deep Dive reports", "API access: programmatic Form 4 data", "Webhook integration", "Unlimited watchlist tickers", "Priority custom report requests (24h)", "CSV and JSON data export"], border: "", btn: "border border-[var(--color-border)] text-[color:var(--color-text)]", iconType: "check" as const },
];

const FAQS = [
  { q: "Is following insider buying legal?", a: "Yes. SEC Form 4 filings are public documents filed under Section 16(a) of the Securities Exchange Act of 1934. Monitoring and analyzing them is legal and widely practiced by institutional investors." },
  { q: "How fast are the alerts?", a: "Median delivery time: under 60 seconds from SEC EDGAR publication. Free plan has a 15-minute delay. Analyst and Investor plans receive filings in real time." },
  { q: "Is this financial advice?", a: "No. EarlyInsider provides structured analysis of public SEC data. Conviction scores reflect pattern analysis, not buy/sell recommendations. All investment decisions are yours." },
  { q: "How is this different from OpenInsider?", a: "OpenInsider shows raw data tables, updated in batches with no analysis. EarlyInsider delivers parsed, scored, AI-analyzed alerts in under 60 seconds with plain-English context." },
  { q: "What is a conviction score?", a: "A 0-100 score weighing trade size vs. historical average, executive track record, cluster activity, and sector context. Scores above 75 are classified as high-conviction signals." },
  { q: "Can I cancel anytime?", a: "Yes. Cancel in one click from your dashboard. No contracts, no cancellation fees. Annual plans refunded pro-rata for unused months." },
];

// h = visual height in px. Tall/square logos (VISA, AMD) get smaller h, wide/thin logos (Berkshire, J&J) get larger h
const LOGOS: { name: string; domain: string; h: number }[] = [
  { name: "NVIDIA", domain: "nvidia.com", h: 24 },
  { name: "Apple", domain: "apple.com", h: 28 },
  { name: "Microsoft", domain: "microsoft.com", h: 24 },
  { name: "Amazon", domain: "amazon.com", h: 28 },
  { name: "Meta", domain: "meta.com", h: 50 },
  { name: "Tesla", domain: "tesla.com", h: 16 },
  { name: "Google", domain: "google.com", h: 28 },
  { name: "JPMorgan", domain: "jpmorgan.com", h: 26 },
  { name: "Goldman Sachs", domain: "goldmansachs.com", h: 32 },
  { name: "Berkshire Hathaway", domain: "berkshirehathaway.com", h: 21 },
  { name: "J&J", domain: "jnj.com", h: 20 },
  { name: "UnitedHealth", domain: "unitedhealthgroup.com", h: 20 },
  { name: "Visa", domain: "visa.com", h: 18 },
  { name: "Mastercard", domain: "mastercard.com", h: 21 },
  { name: "Pfizer", domain: "pfizer.com", h: 31 },
  { name: "Eli Lilly", domain: "lilly.com", h: 32 },
  { name: "Broadcom", domain: "broadcom.com", h: 23 },
  { name: "AMD", domain: "amd.com", h: 18 },
  { name: "Netflix", domain: "netflix.com", h: 20 },
  { name: "Costco", domain: "costco.com", h: 26 },
];

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");

  return (
    <div className="bg-white">

      {/* ═══ 1. HERO ═══ */}
      <section className="relative w-full min-h-[500px] lg:h-[614px] overflow-hidden">
        <img src="/images/hero-mobile.jpg" alt="" className="absolute inset-0 w-full h-full object-cover md:hidden" />
        <img src="/images/hero-desktop.jpg" alt="" className="absolute inset-0 w-full h-full object-cover hidden md:block" />
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 flex flex-col justify-center max-w-[1154px] mx-auto h-full px-[20px] md:px-[48px] pt-[100px] pb-[60px] lg:pt-[0px] lg:pb-[0px]">
          <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[42px] lg:text-[54px] font-normal leading-[1.15] tracking-[0.5px] text-white mb-[16px]">
            Know What CEOs Are Buying.<br />In Seconds, Not Days.
          </h1>
          <p className="text-[19px] font-normal leading-[32px] text-white/90 max-w-[672px] mb-[12px]">
            Every Form 4 filing across 17,325+ public companies &mdash; parsed, scored for conviction, and delivered to your inbox in under 60 seconds.
          </p>
          <p className="text-[14px] font-normal leading-[20px] text-white/60 mb-[32px]">
            All data sourced directly from SEC EDGAR.
          </p>
          <div className="flex flex-col sm:flex-row gap-[12px] sm:gap-[16px]">
            <Link href="/alerts" className="flex items-center justify-center h-[58px] sm:h-[62px] px-[24px] sm:px-[40px] bg-[var(--color-primary)] text-white text-[18px] font-semibold hover:bg-[var(--color-primary-dark)] transition-colors">
              See Recent Insider Trades
            </Link>
            <Link href="#how-it-works" className="flex items-center justify-center h-[58px] sm:h-[62px] px-[24px] sm:px-[40px] border border-white/80 text-white text-[18px] font-semibold hover:bg-white/10 transition-colors">
              How It Works
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ 1.5 LOGO TICKER ═══ */}
      <section className="w-full py-[24px] bg-white overflow-hidden" aria-hidden="true">
        <div className="logo-ticker flex items-center gap-[56px]" style={{ width: "max-content" }}>
          {[...LOGOS, ...LOGOS].map((logo, i) => (
            <img key={i} src={`https://cdn.brandfetch.io/domain/${logo.domain}/w/400/h/120/logo?c=1idSo4YEEODo2rW6Anw`} alt={logo.name} className="w-auto shrink-0 object-contain" style={{ height: `${logo.h}px` }} />
          ))}
        </div>
        <style>{`@keyframes scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}.logo-ticker{animation:scroll 90s linear infinite}@media(max-width:768px){.logo-ticker{animation-duration:140s}}`}</style>
      </section>


      {/* ═══ 2. LIVE ALERT FEED ═══ */}
      <section className="w-full py-[var(--section-y-mobile)] px-[20px] md:pt-[var(--section-y)] md:px-[48px] md:pb-[var(--section-y)] bg-white">
        <div className="max-w-[1154px] mx-auto">
          <div className="flex flex-col-reverse items-center lg:flex-row lg:items-center lg:justify-center gap-[12px] lg:gap-[16px] mb-[48px]">
            <h2 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-title)] font-normal leading-[1.1] tracking-[0.5px] text-[color:var(--color-text)] text-center">SEC Form 4 Feed</h2>
            <div className="flex items-center gap-[8px] bg-[#00de16]/20 px-[12px] py-[4px] rounded-full">
              <div className="w-[8px] h-[8px] rounded-full bg-[var(--color-signal-green)]" />
              <span className="text-[15px] md:text-[12px] font-medium tracking-[0.5px] text-[color:var(--color-signal-green)]">Live</span>
            </div>
          </div>
          {/* Desktop rows — attached block */}
          <div className="hidden lg:flex flex-col mb-[var(--gap-tight)] overflow-hidden shadow-[0px_1px_2px_rgba(0,0,0,0.05)] border border-[var(--color-border)]">
            {ALERTS.map((a, i) => (
              <div key={i} className={`flex items-center justify-between h-[112px] px-[32px] ${i % 2 === 0 ? "bg-[var(--color-bg-alt)]" : "bg-white"} ${i > 0 ? "border-t border-[var(--color-border)]" : ""}`}>
                <div className="flex items-center gap-[24px] w-[280px] shrink-0">
                  <div className="w-[58px] h-[58px] rounded-full bg-[#d9d9d9] flex items-center justify-center text-[13px] font-semibold text-[color:var(--color-text-muted)]">
                    {a.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div className="flex flex-col gap-[4px]">
                    <span className="text-[13px] font-normal text-[color:var(--color-text-muted)]">{a.title}</span>
                    <span className="font-[var(--font-montaga)] text-[15px] font-normal leading-[22px] text-[color:var(--color-text)]">{a.name}</span>
                  </div>
                </div>
                <span className="text-[24px] font-medium leading-[32px] text-[color:var(--color-text)]">{a.ticker}</span>
                <span className="text-[20px] font-medium text-[color:var(--color-signal-green)]">{a.amount}</span>
                <span className="text-[16px] font-normal text-[color:var(--color-text-secondary)]">{a.time}</span>
              </div>
            ))}
          </div>

          {/* Mobile/tablet rows — attached, card layout */}
          <div className="lg:hidden overflow-hidden mb-[var(--gap-tight)] border border-[var(--color-border)]">
            {ALERTS.map((a, i) => (
              <div key={i} className={`flex items-center gap-[12px] px-[var(--gap-tight)] py-[14px] ${i % 2 === 0 ? "bg-[#F8F8F8]" : "bg-white"} ${i > 0 ? "border-t border-[var(--color-border)]" : ""}`}>
                <div className="w-[46px] h-[46px] rounded-full bg-[#d9d9d9] flex items-center justify-center text-[12px] font-semibold text-[color:var(--color-text-muted)] shrink-0">
                  {a.name.split(" ").map(n => n[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-medium leading-[18px] text-[color:var(--color-text)] truncate">{a.name}</p>
                  <p className="text-[13px] font-normal text-[color:var(--color-text-muted)]">{a.title}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[14px] font-semibold tracking-[0.5px] text-[color:var(--color-text)] font-[var(--font-mono)]">{a.ticker}</p>
                  <p className="text-[15px] font-semibold text-[color:var(--color-signal-green)]">{a.amount}</p>
                  <p className="text-[14px] font-normal text-[color:var(--color-text-muted)]">{a.time}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[16px] font-normal leading-[20px] text-[color:var(--color-text-muted)] text-center mt-[24px]">Source: SEC Form 4 Filings. Data updated every 15 seconds.</p>
        </div>
      </section>

      {/* ═══ 3. HOW IT WORKS ═══ */}
      <section id="how-it-works" className="w-full pt-[var(--section-y-mobile)] px-[20px] pb-[var(--section-y-mobile)] md:pb-[var(--section-y)] bg-white">
        <div className="max-w-[1080px] mx-auto px-[32px]">
          <h2 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-title)] font-normal leading-[1.1] tracking-[0.5px] text-[color:var(--color-text)] text-center mb-[40px] md:mb-[80px]">Three Steps. Under 60 Seconds.</h2>
          <div className="flex flex-col md:flex-row justify-between gap-[40px] md:gap-[63px]">
            {[
              { title: "Monitor", desc: "17,325+ public companies. Every Form 3, Form 4, and Schedule 13D filed with the SEC. Continuous monitoring, no gaps." },
              { title: "Analyze", desc: "80% of insider filings are routine compensation or pre-scheduled 10b5-1 plans. Our scoring model isolates the 20% that signal genuine conviction \u2014 and tells you why." },
              { title: "Deliver", desc: "Filing to inbox: under 60 seconds. The average retail investor sees the same data 24\u201348 hours later. 25% of abnormal returns from insider purchases accrue within 5 trading days." },
            ].map((s) => (
              <div key={s.title} className="w-full md:w-[296px] text-center">
                <div className="w-[64px] h-[64px] rounded-full bg-[var(--color-bg-alt)] mx-auto mb-[var(--gap-tight)]" />
                <h3 className="font-[var(--font-montaga)] text-[26px] md:text-[22px] font-normal leading-[28px] text-[color:var(--color-text)] mb-[8px]">{s.title}</h3>
                <p className="text-[16px] font-normal leading-[26px] text-[color:var(--color-text-secondary)]">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 4. WHY INSIDER BUYING MATTERS ═══ */}
      <section className="w-full py-[var(--section-y-mobile)] px-[20px] md:pt-[var(--section-y)] md:px-[48px] md:pb-[var(--section-y)] bg-[var(--color-bg-alt)]">
        <h2 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-title)] font-normal leading-[1.1] tracking-[0.5px] text-[color:var(--color-text)] max-w-[1084px] mx-auto mb-[32px] text-center lg:text-left">Why Insider Buying Matters</h2>
        <div className="max-w-[1084px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-[var(--gap-items)]">
          {STATS.map((s) => (
            <div key={s.value} className="bg-white p-[32px] py-[40px]">
              <p className="font-[var(--font-montaga)] text-[40px] lg:text-[48px] font-normal leading-[1.1] tracking-[0.5px] text-[color:var(--color-text)]">{s.value}</p>
              <p className="font-[var(--font-montaga)] text-[21px] font-normal leading-[28px] text-[color:var(--color-text)] mb-[16px] mt-[4px]">{s.label}</p>
              <p className="text-[16px] font-normal leading-[23px] text-[color:var(--color-text-secondary)] mb-[12px]">{s.desc}</p>
              <p className="text-[13px] font-normal leading-[22px] tracking-[0.5px] text-[color:var(--color-text-muted)]">{s.source}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ 5. DETAILED ALERT CARD ═══ */}
      <section className="w-full py-[var(--section-y-mobile)] px-[20px] md:pt-[var(--section-y)] md:px-[48px] md:pb-[54px] bg-white">
        <div className="max-w-[1084px] mx-auto border border-black/10 overflow-hidden">
          <div className="bg-[var(--color-bg-alt)] border-b border-black/10 px-[var(--gap-tight)] py-[20px] md:px-[32px] md:py-[32px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[12px] md:gap-[var(--gap-tight)]">
                <div className="w-[48px] h-[48px] rounded-full bg-[#d9d9d9] shrink-0" />
                <div>
                  <h3 className="text-[16px] md:text-[20px] font-medium leading-[24px] md:leading-[28px] text-[color:var(--color-text)] font-[var(--font-montaga)]">NVDA / NVIDIA Corp</h3>
                  <div className="flex flex-col md:flex-row md:items-center gap-[4px] md:gap-[8px] mt-[2px]">
                    <span className="bg-[var(--color-signal-green)] text-white text-[13px] px-[8px] py-[2px] rounded-[2px] self-start">High Conviction</span>
                    <span className="text-[12px] tracking-[0.5px] text-[color:var(--color-text-muted)]">Alert ID: #88321-X</span>
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0 ml-[12px]">
                <p className="text-[20px] md:text-[24px] font-bold leading-[28px] md:leading-[32px] text-[color:var(--color-signal-green)] font-[var(--font-mono)]">BUY</p>
                <p className="text-[12px] tracking-[0.5px] text-[color:var(--color-text-muted)]">SEC Form 4</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[32px] md:gap-[40px] p-[20px] md:p-[40px]">
            <div>
              <p className="text-[13px] tracking-[0.5px] text-[color:var(--color-text-muted)] mb-[24px]">Transaction Data</p>
              {[["Insider","Jensen Huang (CEO)"],["Shares Purchased","240,000"],["Average Price","$130.15"],["Total Value","$2,298,580"]].map(([l,v])=>(
                <div key={l} className="flex justify-between py-[8px] border-b border-[var(--color-border-light)]">
                  <span className="text-[16px] leading-[24px] text-[color:var(--color-text-secondary)]">{l}</span>
                  <span className={`text-[16px] font-semibold leading-[24px] ${l==="Total Value"?"text-[color:var(--color-signal-green)]":"text-[color:var(--color-text)]"}`}>{v}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-[13px] tracking-[0.5px] text-[color:var(--color-text-muted)] mb-[24px]">AI Analysis</p>
              <div className="bg-[var(--color-bg-alt)] p-[24px] space-y-[var(--gap-tight)]">
                <div>
                  <p className="text-[16px] font-semibold text-[color:var(--color-text)] mb-[4px]">CONTEXT</p>
                  <p className="text-[14px] leading-[20px] text-[color:var(--color-text)]">340% above historical average purchase size for this executive.</p>
                </div>
                <div className="border-t border-[var(--color-border)] pt-[var(--gap-tight)]">
                  <p className="text-[16px] font-semibold text-[color:var(--color-text)] mb-[4px]">HISTORICAL PERFORMANCE</p>
                  <p className="text-[14px] leading-[20px] text-[color:var(--color-text)]">Huang&apos;s last 3 purchases preceded an average 18% 60-day price gain.</p>
                </div>
                <div className="border-t border-[var(--color-border)] pt-[var(--gap-tight)]">
                  <p className="text-[16px] font-semibold text-[color:var(--color-text)] mb-[4px]">SENTIMENT SCORE</p>
                  <div className="flex items-center gap-[8px]">
                    <div className="flex-1 h-[4px] bg-[var(--color-border)] rounded-full"><div className="h-full w-[87%] bg-[var(--color-signal-green)] rounded-full" /></div>
                    <span className="text-[16px] font-semibold text-[color:var(--color-signal-green)]">87/100</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-[14px] leading-[20px] text-[color:var(--color-text-secondary)] text-center italic px-[32px] pt-[16px] pb-[20px]">
            &ldquo;Huang&apos;s purchase is the largest individual open-market buy since Q2 2026, signaling immense internal confidence in upcoming product cycles.&rdquo;
          </p>
        </div>
        <div className="flex flex-col md:flex-row items-center justify-center gap-[32px] md:gap-[60px] pt-[60px] pb-[16px]">
          {[{v:"$4.2B",l:"Tracked Monthly"},{v:"2,847",l:"Alerts Sent (24h)"},{v:"17,325+",l:"Companies Monitored"}].map((m,i)=>(
            <div key={m.v} className="flex items-center gap-[60px]">
              <div className="text-center md:text-center">
                <p className="font-[var(--font-montaga)] text-[48px] font-normal leading-[40px] tracking-[0.5px] text-[color:var(--color-text)]">{m.v}</p>
                <p className="text-[18px] leading-[20px] text-[color:var(--color-text-secondary)] mt-[14px]">{m.l}</p>
              </div>
              {i<2&&<div className="w-[1px] h-[48px] bg-[var(--color-text)] hidden md:block" />}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ 6. CHARTS ═══ */}
      <section className="w-full py-[var(--section-y-mobile)] px-[20px] md:pt-[var(--section-y)] md:px-[48px] md:pb-[102px] bg-[var(--color-bg-alt)]">
        <div className="max-w-[1144px] mx-auto px-[32px]">
          <h2 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-title)] font-normal leading-[1.1] tracking-[0.5px] text-[color:var(--color-text)] mb-[40px] md:mb-[64px] text-center lg:text-left">See the Pattern</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-items)] lg:gap-[var(--gap-cards)]">
            <div className="bg-white p-[40px] h-[400px]">
              <p className="text-[18px] leading-[28px] text-[color:var(--color-text)] mb-[32px]">Insider Buying vs Stock Price (S&P 500)</p>
              <div className="h-[229px] relative">
                <div className="absolute inset-0 flex flex-col justify-between">{[0,1,2,3].map(i=><div key={i} className="w-full h-[1px] bg-[var(--color-border)]"/>)}</div>
                <svg className="relative w-full h-full" viewBox="0 0 436 160" fill="none">
                  <path d="M0 140C50 130 100 120 150 100S250 60 300 40S380 20 436 10" stroke="#000592" strokeWidth="3"/>
                  <path d="M0 150C50 145 100 140 150 130S250 110 300 100S380 85 436 70" stroke="#00d26a" strokeWidth="3"/>
                </svg>
              </div>
              <div className="flex justify-between mt-[var(--gap-tight)]">{["Jan","Mar","May","Jul","Sep","Nov"].map(m=><span key={m} className="text-[12px] tracking-[0.5px] text-[color:var(--color-text-muted)]">{m}</span>)}</div>
            </div>
            <div className="bg-white p-[40px] h-[400px]">
              <p className="text-[18px] leading-[28px] text-[color:var(--color-text)] mb-[32px]">Monthly Insider Buying Activity ($B)</p>
              <div className="flex items-end justify-center gap-[12px] h-[229px] px-[var(--gap-tight)]">
                {[91,137,68,183,114,217,103].map((h,i)=>(<div key={i} className="w-[47px] bg-[var(--color-primary)]" style={{height:`${h}px`}}/>))}
              </div>
              <div className="flex justify-between px-[var(--gap-tight)] mt-[var(--gap-tight)]">{["Jul","Aug","Sep","Oct","Nov","Dec","Jan"].map(m=><span key={m} className="text-[12px] tracking-[0.5px] text-[color:var(--color-text-muted)]">{m}</span>)}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 6.5 DEEP DIVE REPORTS ═══ */}
      <section className="w-full py-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] bg-[var(--color-primary-dark)] overflow-x-clip">
        <div className="max-w-[1136px] mx-auto px-[20px] md:px-[32px]">
          <h2 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-title)] leading-[1.2] tracking-[0.5px] text-white text-center mb-[12px]">Institutional-Grade Research at Analyst Pricing</h2>
          <p className="text-[16px] leading-[24px] text-white/70 text-center mb-[37px]">Single-stock deep dives, sector analysis, and dividend safety reports. SEC insider data cross-referenced with fundamentals. Each report includes an explicit verdict.</p>
          {/* Desktop: 3-col grid / Mobile: horizontal scroll carousel */}
          <div className="hidden lg:grid grid-cols-3 gap-[var(--gap-items)] px-[50px] mb-[37px]">
            {REPORTS.map((r)=>(
              <div key={r.label} className={`bg-white p-[32px] shadow-[0px_1px_2px_rgba(0,0,0,0.05)] border border-black/10 ${r.best?"ring-2 ring-[var(--color-primary)]":""}`}>
                <div className="flex items-center gap-[12px] mb-[24px]">
                  <div className="w-[32px] h-[32px] bg-[var(--color-bg-alt)] rounded" />
                  <span className="text-[16px] font-medium tracking-[1px] text-[color:var(--color-text)] font-[var(--font-mono)]">{r.label}</span>
                </div>
                <h3 className="font-[var(--font-montaga)] text-[26px] leading-[28px] tracking-[1px] text-[color:var(--color-text)] mb-[4px]">{r.title}</h3>
                <p className="text-[14px] leading-[20px] tracking-[1px] text-[color:var(--color-primary)] mb-[33px]">{r.pages}</p>
                <ul className="space-y-[var(--gap-tight)] mb-[40px]">
                  {r.features.map(f=>(<li key={f} className="flex items-center gap-[12px]"><svg className="w-[11px] h-[8px] shrink-0" viewBox="0 0 11 8"><path d="M1 4l3 3L10 1" stroke="#006d34" strokeWidth="2" fill="none"/></svg><span className="text-[14px] leading-[20px] text-[color:var(--color-text)]">{f}</span></li>))}
                </ul>
                <p className="font-[var(--font-montaga)] text-[48px] leading-[36px] tracking-[1px] text-[color:var(--color-text)] mb-[8px]">{r.price}</p>
                <p className="text-[14px] font-light tracking-[1px] text-[color:var(--color-text-muted)] mb-[24px]">*one-time payment</p>
                <Link href="/reports" className="flex items-center justify-center w-full h-[50px] bg-[var(--color-primary)] text-white text-[16px] font-medium tracking-[1px]">Get Access</Link>
              </div>
            ))}
          </div>

          {/* Mobile carousel — extends past container to scroll edge-to-edge */}
          <div className="lg:hidden flex gap-[var(--gap-tight)] overflow-x-auto snap-x snap-mandatory pb-[var(--gap-tight)] mb-[37px] scrollbar-hide -mx-[20px] px-[20px]">
            {REPORTS.map((r, ri)=>(
              <div key={r.label} className={`bg-white p-[28px] shadow-[0px_1px_2px_rgba(0,0,0,0.05)] border border-black/10 min-w-[280px] max-w-[300px] shrink-0 snap-center ${ri===REPORTS.length-1?"mr-[20px]":""} ${r.best?"ring-2 ring-[var(--color-primary)]":""}`}>
                <div className="flex items-center gap-[12px] mb-[20px]">
                  <div className="w-[32px] h-[32px] bg-[var(--color-bg-alt)] rounded" />
                  <span className="text-[14px] font-medium tracking-[1px] text-[color:var(--color-text)] font-[var(--font-mono)]">{r.label}</span>
                </div>
                <h3 className="font-[var(--font-montaga)] text-[22px] leading-[26px] tracking-[1px] text-[color:var(--color-text)] mb-[4px]">{r.title}</h3>
                <p className="text-[13px] leading-[18px] tracking-[1px] text-[color:var(--color-primary)] mb-[24px]">{r.pages}</p>
                <ul className="space-y-[12px] mb-[28px]">
                  {r.features.map(f=>(<li key={f} className="flex items-center gap-[10px]"><svg className="w-[11px] h-[8px] shrink-0" viewBox="0 0 11 8"><path d="M1 4l3 3L10 1" stroke="#006d34" strokeWidth="2" fill="none"/></svg><span className="text-[13px] leading-[18px] text-[color:var(--color-text)]">{f}</span></li>))}
                </ul>
                <p className="font-[var(--font-montaga)] text-[36px] leading-[32px] tracking-[1px] text-[color:var(--color-text)] mb-[6px]">{r.price}</p>
                <p className="text-[12px] font-light tracking-[1px] text-[color:var(--color-text-muted)] mb-[20px]">*one-time payment</p>
                <Link href="/reports" className="flex items-center justify-center w-full h-[46px] bg-[var(--color-primary)] text-white text-[16px] font-medium tracking-[1px]">Get Access</Link>
              </div>
            ))}
          </div>
          <style>{`.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}`}</style>
          <div className="text-center">
            <Link href="/reports" className="text-[16px] font-medium tracking-[1px] text-white hover:underline">Browse Research Library &rarr;</Link>
          </div>
        </div>
      </section>

      {/* ═══ 7.5 NEWSLETTER CAPTURE ═══ */}
      <section className="w-full py-[var(--section-y-mobile)] md:py-[var(--section-y)] bg-[var(--color-bg-dark)]">
        <div className="max-w-[720px] mx-auto px-[20px] md:px-[32px] text-center">
          <EmailCapture
            heading="The CEO Alpha Report"
            subheading="50,247 CEO stock purchases. 12 years of data. 7 filters that separated the 23.4% winners from the noise. Updated monthly. Free."
            bullets={[
              "Every CEO purchase that scored 75+ conviction in the last 30 days",
              "The 7-filter methodology: what we track, how we score it, what we ignore",
              "Sector-by-sector insider sentiment — which industries executives are buying into",
              "One explicit verdict per featured stock: BUY, CAUTION, or WAIT",
            ]}
            ctaText="Get the Free Report"
            placement="homepage_newsletter"
            variant="hero"
            dark
          />
        </div>
      </section>

      {/* ═══ 8. PRICING ═══ */}
      <section className="w-full py-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] bg-[var(--color-bg-alt)]">
        <div className="max-w-[1216px] mx-auto px-[20px] md:px-[32px]">
          <h2 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-title)] leading-[1.1] tracking-[0.5px] text-[color:var(--color-text)] text-center mb-[12px]">Choose Your Signal Level</h2>
          <p className="text-[16px] leading-[24px] text-[color:var(--color-text-secondary)] text-center mb-[24px] md:mb-[40px]">All plans include the SEC EDGAR real-time feed.</p>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-[4px] mb-[40px] md:mb-[64px] border border-[var(--color-border)] rounded-[8px] w-fit mx-auto p-[4px]">
            <button
              onClick={() => setBilling("monthly")}
              className={`px-[20px] py-[10px] text-[14px] font-medium leading-[20px] transition-colors ${billing === "monthly" ? "bg-white text-[color:var(--color-text)] shadow-sm" : "text-[color:var(--color-text-muted)]"}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling("annual")}
              className={`px-[20px] py-[10px] text-[14px] font-medium leading-[20px] transition-colors flex items-center gap-[8px] ${billing === "annual" ? "bg-white text-[color:var(--color-text)] shadow-sm" : "text-[color:var(--color-text-muted)]"}`}
            >
              Annually
              <span className="bg-[var(--color-signal-green)] text-white text-[11px] font-bold px-[8px] py-[2px] rounded-[2px]">SAVE 21%</span>
            </button>
          </div>

          <div className="max-w-[1024px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-[var(--gap-items)]">
            {PLANS.map((p)=>(
              <div key={p.name} className={`bg-white p-[28px] md:p-[48px] relative ${p.border}`}>
                {p.popular&&<div className="absolute -top-[15px] left-1/2 -translate-x-1/2 bg-[var(--color-signal-green)] text-white text-[11px] font-extrabold tracking-[1px] px-[16px] py-[4px] rounded-[2px] whitespace-nowrap">MOST POPULAR</div>}
                <h3 className="font-[var(--font-montaga)] text-[32px] leading-[32px] tracking-[1px] text-[color:var(--color-text)] mb-[8px]">{p.name}</h3>
                <p className="text-[14px] leading-[20px] tracking-[1px] text-[color:var(--color-text-secondary)] mb-[16px]">{p.desc}</p>
                <div className="flex items-baseline mb-[8px]">
                  <span className="font-[var(--font-montaga)] text-[48px] leading-[48px] tracking-[0.5px] text-[color:var(--color-text)]">{billing === "annual" ? p.priceAnnual : p.priceMonthly}</span>
                  <span className="text-[16px] leading-[24px] text-[color:var(--color-text-muted)] ml-[4px]">/mo</span>
                </div>
                {billing === "annual" && p.name !== "Free" && <p className="text-[12px] font-normal leading-[16px] text-[color:var(--color-text-muted)] mb-[32px]">billed annually</p>}
                {(billing !== "annual" || p.name === "Free") && <div className="mb-[32px]" />}
                <ul className="flex flex-col gap-[16px] mb-[48px]">
                  {p.features.map(f=>(<li key={f} className="flex items-center gap-[12px] text-[14px] leading-[20px] text-[color:var(--color-text)]">
                    {p.iconType === "badge" ? (
                      <div className="w-[15px] h-[15px] rounded-full bg-[var(--color-primary)] flex items-center justify-center shrink-0">
                        <svg className="w-[8px] h-[8px]" viewBox="0 0 8 8"><path d="M1 4l2 2L7 2" stroke="white" strokeWidth="1.5" fill="none"/></svg>
                      </div>
                    ) : (
                      <svg className="w-[11px] h-[8px] shrink-0" viewBox="0 0 11 8"><path d="M1 4l3 3L10 1" stroke="#006d34" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                    {f}
                  </li>))}
                </ul>
                <Link href="/signup" className={`flex items-center justify-center w-full h-[58px] text-[16px] font-medium tracking-[1px] transition-colors ${p.btn}`}>{p.name === "Free" ? "Start Monitoring Free" : "Get Access"}</Link>
              </div>
            ))}
          </div>
          <p className="text-[14px] leading-[20px] text-[color:var(--color-text-muted)] text-center mt-[32px]">Last week: 847 Form 4 filings. 23 triggered high-conviction alerts. Free users received the digest on Monday.</p>
        </div>
      </section>

      {/* ═══ 9. FAQ ═══ */}
      <section className="w-full py-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] bg-white">
        <div className="max-w-[800px] mx-auto px-[20px] md:px-[32px]">
          <h2 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-title)] leading-[1.1] tracking-[0.5px] text-[color:var(--color-text)] text-center mb-[40px] md:mb-[64px]">Frequently Asked Questions</h2>
          <div className="flex flex-col gap-[var(--gap-items)]">
            {FAQS.map((faq,i)=>(
              <div key={i} className="border-b border-[var(--color-border-light)] pb-[24px]">
                <button onClick={()=>setOpenFaq(openFaq===i?null:i)} className="w-full flex items-center justify-between">
                  <span className="text-[16px] md:text-[18px] leading-[28px] text-[color:var(--color-text)] text-left">{faq.q}</span>
                  <svg className={`w-[12px] h-[12px] shrink-0 ml-[var(--gap-tight)] text-[color:var(--color-text-muted)] transition-transform ${openFaq===i?"rotate-45":""}`} viewBox="0 0 12 12"><path d="M6 0v12M0 6h12" stroke="currentColor" strokeWidth="2"/></svg>
                </button>
                {openFaq===i&&<p className="mt-[var(--gap-tight)] text-[15px] md:text-[16px] leading-[24px] md:leading-[26px] text-[color:var(--color-text-secondary)]">{faq.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 10. FINAL CTA ═══ */}
      <section className="w-full bg-[var(--color-bg-dark)] py-[var(--section-y-mobile)] md:py-[var(--section-y-hero)]">
        <div className="max-w-[1216px] mx-auto px-[32px] text-center">
          <h2 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-title)] leading-[1.2] tracking-[0.5px] text-white mb-[var(--gap-tight)]">142 Form 4 Filings Today. Your Pipeline: Empty.</h2>
          <p className="text-[20px] leading-[28px] text-white/60 max-w-[672px] mx-auto mb-[32px]">Set up your watchlist in 60 seconds. The next filing that matters to your portfolio will arrive before you finish reading this sentence.</p>
          <Link href="/signup" className="inline-flex items-center justify-center h-[56px] px-[48px] bg-[var(--color-primary)] text-white text-[16px] font-medium tracking-[1px] hover:bg-[var(--color-primary-dark)] transition-colors">Start Monitoring Free</Link>
        </div>
      </section>

      {/* Footer is rendered globally from layout.tsx */}
    </div>
  );
}
