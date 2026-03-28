"use client";

import Link from "next/link";
import { useState } from "react";

const CATEGORIES = ["All", "Getting Started", "Alerts", "Pricing", "Data & Security", "Account"];

const CATEGORY_TO_GROUPS: Record<string, string[]> = {
  "Getting Started": ["Platform & Data"],
  "Alerts": ["Alerts & Analysis"],
  "Pricing": ["Billing & Access"],
  "Data & Security": ["Platform & Data", "Security & Privacy"],
  "Account": ["Billing & Access"],
};

const FAQ_GROUPS = [
  {
    title: "Platform & Data",
    items: [
      { q: "Where does EarlyInsider get its data?", a: "All insider trading data is sourced directly from SEC EDGAR. EarlyInsider monitors Form 3, Form 4, Form 5, and Schedule 13D/13G filings across 17,325+ public companies. Every alert includes a direct link to the original SEC EDGAR filing for independent verification." },
      { q: "Is insider trading data legal to use?", a: "Yes. SEC Form 4 filings are public documents, published on SEC EDGAR by federal mandate under Section 16(a) of the Securities Exchange Act of 1934. Monitoring and analyzing these filings is legal and widely practiced by institutional investors.", open: true },
      { q: "How many companies does EarlyInsider cover?", a: "17,325+ public companies listed on NYSE, NASDAQ, and OTC markets. The historical database contains 94M+ indexed records spanning over 10 years of filing, pricing, and fundamental data." },
      { q: "How accurate is the data?", a: "Filing data is parsed directly from SEC EDGAR XBRL feeds. Parsed values are validated against the structured XML before delivery. Conviction scores are algorithmic, computed from 7 weighted factors documented on the Methodology page." },
    ],
  },
  {
    title: "Security & Privacy",
    items: [
      { q: "How is my data protected?", a: "All data is encrypted in transit with TLS 1.3 and at rest with AES-256. Authentication is handled by Supabase Auth with bcrypt-hashed passwords. Session tokens are rotated on every login and expire after 24 hours of inactivity." },
      { q: "Does EarlyInsider sell or share my personal data?", a: "No. We do not sell, rent, or share your personal information with third parties for marketing purposes. Your email, payment details, and alert preferences are used exclusively to deliver the EarlyInsider service. See our Privacy Policy for full details." },
      { q: "Is my payment information stored on your servers?", a: "No. All payment processing is handled by Stripe, a PCI Level 1 certified payment processor. EarlyInsider never sees, stores, or has access to your full card number. Stripe tokenizes all payment data independently." },
      { q: "Do you support two-factor authentication (2FA)?", a: "Yes. You can enable 2FA via authenticator app (TOTP) from your account settings. We recommend enabling 2FA for all accounts, especially those on Analyst or Investor plans with webhook integrations." },
      { q: "What is your data retention policy?", a: "Account data is retained for the duration of your subscription plus 30 days after cancellation. Alert history and saved watchlists are permanently deleted 30 days after account closure. You can request immediate deletion at any time via support@earlyinsider.com." },
      { q: "Is EarlyInsider compliant with GDPR and CCPA?", a: "Yes. EU users can exercise their right to access, rectify, or delete personal data under GDPR. California residents have equivalent rights under CCPA. Data deletion requests are processed within 72 hours. Contact privacy@earlyinsider.com for any data rights request." },
    ],
  },
  {
    title: "Alerts & Analysis",
    items: [
      { q: "How fast are the alerts?", a: "Median delivery time is under 60 seconds from the moment a Form 4 filing appears on SEC EDGAR. Free-tier users receive a delayed feed with a 15-minute lag. Analyst and Investor subscribers receive filings in real-time via email, Slack, or webhook." },
      { q: "What is a conviction score?", a: "A numeric score from 0 to 100 assigned to each Form 4 filing after noise filtering. The score weighs 7 factors: trade size vs. historical average, executive seniority and track record, cluster buying activity, timing relative to earnings, historical hit rate, sector momentum, and purchase-to-holdings ratio. Scores above 75 are classified as high-conviction." },
      { q: "How is EarlyInsider different from OpenInsider?", a: "OpenInsider displays raw Form 4 data with no analysis, no conviction scoring, and no real-time alerting. EarlyInsider delivers parsed filings in under 60 seconds, assigns a conviction score, generates plain-English analysis, and filters out the 80% of filings that are routine noise. The Analyst plan costs $24/mo." },
      { q: "How does EarlyInsider handle 10b5-1 pre-planned trades?", a: "The noise filter flags transactions that match known 10b5-1 plan patterns based on transaction codes, filing footnotes, and historical trading regularity. Flagged filings receive reduced conviction scores. The Methodology page lists this as a stated limitation." },
    ],
  },
  {
    title: "Billing & Access",
    items: [
      { q: "Can I cancel anytime?", a: "Yes. Cancel from your account settings page in under 30 seconds. No phone call required, no retention page, no hidden steps. Monthly plans end at the close of the current billing cycle. Annual plans are refunded pro-rata for unused months." },
      { q: "Is there a free trial for paid plans?", a: "Analyst and Investor plans include a 14-day free trial with full access to all plan features. No credit card is required to start the trial. If you take no action after 14 days, your account automatically reverts to the Free tier." },
      { q: "What payment methods are accepted?", a: "Visa, Mastercard, American Express, and Discover. All payments processed through Stripe (PCI Level 1 certified). Annual billing saves 20%: Analyst at $24/mo annual vs. $29/mo monthly; Investor at $84/mo annual vs. $99/mo monthly." },
      { q: "Does EarlyInsider provide financial advice?", a: "No. EarlyInsider is a data analysis platform, not a registered investment advisor. The platform provides structured analysis of public SEC filing data and assigns conviction scores based on documented criteria. No alert constitutes a buy, sell, or hold recommendation." },
    ],
  },
];

export default function FaqPage() {
  const [activeTab, setActiveTab] = useState("All");
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({ "Platform & Data-1": true });
  const visibleGroups = activeTab === "All"
    ? FAQ_GROUPS
    : FAQ_GROUPS.filter(g => (CATEGORY_TO_GROUPS[activeTab] ?? []).includes(g.title));

  function toggle(key: string) {
    setOpenItems((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="bg-[var(--color-bg-alt)]">

      {/* ═══ SECTION 1: HEADER ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-hero-mobile)] pb-[var(--section-y-hero-mobile)] md:pt-[var(--section-y-hero)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[32px]">
        <div className="max-w-[896px] mx-auto text-center">
          <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[54px] font-normal leading-[1.1] md:leading-[60px] text-[color:var(--color-text)] mb-[var(--gap-tight)] md:mb-[24px]">
            Frequently Asked Questions
          </h1>
          <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[29px] text-[color:var(--color-text-secondary)] max-w-[672px] mx-auto">
            Everything you need to know about our institutional-grade insider trading intelligence platform and SEC data processing.
          </p>
        </div>
      </section>

      {/* ═══ SECTION 2: CATEGORY TABS ═══ */}
      <div className="bg-white border-b border-[var(--color-border)] sticky top-[82px] z-40 overflow-x-auto">
        <div role="tablist" aria-label="FAQ Categories" className="max-w-[976px] mx-auto px-[20px] md:px-[32px] flex items-center justify-start md:justify-center gap-[20px] md:gap-[32px] py-[16px]">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              role="tab"
              aria-selected={activeTab === cat}
              onClick={() => setActiveTab(cat)}
              className={`text-[14px] leading-[20px] pb-[16px] border-b-[1px] transition-colors whitespace-nowrap ${
                activeTab === cat
                  ? "font-bold text-[color:var(--color-primary)] border-[var(--color-primary)]"
                  : "font-normal text-[color:var(--color-text-secondary)] border-transparent hover:text-[color:var(--color-text)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ SECTION 3: FAQ ACCORDION ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[780px] mx-auto flex flex-col gap-[48px] md:gap-[80px]">
          {visibleGroups.map((group) => (
            <div key={group.title}>
              <h2 className="font-[var(--font-montaga)] text-[26px] md:text-[30px] font-normal leading-[32px] text-[color:var(--color-text)] pl-[16px] border-l-[3px] border-[var(--color-primary)] mb-[24px] md:mb-[32px]">
                {group.title}
              </h2>
              <div className="flex flex-col gap-[12px] md:gap-[16px]">
                {group.items.map((item, i) => {
                  const key = `${group.title}-${i}`;
                  const isOpen = openItems[key] || false;
                  return (
                    <div key={key} className="bg-[var(--color-bg-alt)]">
                      <button
                        onClick={() => toggle(key)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between p-[20px] md:p-[24px]"
                      >
                        <span className="text-[15px] md:text-[16px] font-medium leading-[24px] md:leading-[28px] text-[color:var(--color-text)] text-left pr-[16px] md:pr-[24px]">
                          {item.q}
                        </span>
                        <svg
                          className={`w-[12px] h-[12px] shrink-0 text-[color:var(--color-text)] transition-transform ${isOpen ? "rotate-45" : ""}`}
                          viewBox="0 0 12 12"
                        >
                          <path d="M6 0v12M0 6h12" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </button>
                      {isOpen && (
                        <div className="px-[20px] pb-[20px] md:px-[24px] md:pb-[24px]">
                          <p className="text-[15px] md:text-[16px] font-normal leading-[24px] md:leading-[26px] text-[color:var(--color-text-secondary)]">
                            {item.a}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ SECTION 4: STILL HAVE QUESTIONS ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[896px] mx-auto text-center">
          <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[40px] text-[color:var(--color-text)] mb-[16px]">
            Still have questions?
          </h2>
          <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[28px] text-[color:var(--color-text-secondary)] max-w-[576px] mx-auto mb-[24px]">
            Our dedicated support team and institutional analysts are available 24/7 to assist with your technical or data inquiries.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-[12px] sm:gap-[15px] pt-[24px]">
            <Link
              href="mailto:support@earlyinsider.com"
              className="flex items-center justify-center h-[54px] md:h-[58px] px-[32px] border border-[var(--color-primary)] text-[15px] md:text-[16px] font-medium leading-[24px] text-[color:var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors w-full sm:w-auto"
            >
              Contact Support
            </Link>
            <Link
              href="/methodology"
              className="flex items-center justify-center h-[54px] md:h-[58px] px-[32px] border border-[var(--color-primary)] text-[15px] md:text-[16px] font-medium leading-[24px] text-[color:var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors w-full sm:w-auto"
            >
              View Documentation
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5: BENTO DECORATIVE ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[1104px] mx-auto grid grid-cols-1 lg:grid-cols-[725px_346px] gap-[24px] lg:gap-[33px]">
          {/* Left — Dark card */}
          <div className="bg-[var(--color-primary)] p-[32px] md:p-[48px] flex flex-col justify-between min-h-[300px] lg:h-[400px]">
            <div>
              <p className="text-[14px] font-normal leading-[16px] text-white/80 mb-[16px]">Intelligence Briefing</p>
              <h3 className="font-[var(--font-montaga)] text-[28px] md:text-[length:var(--text-title)] font-normal leading-[1.15] md:leading-[36px] text-white">
                Master the markets with institutional precision.
              </h3>
            </div>
            <div className="flex items-center gap-[16px] mt-[32px] lg:mt-0">
              <div className="w-[48px] h-[48px] bg-white/10 rounded flex items-center justify-center shrink-0">
                <svg className="w-[18px] h-[10px]" viewBox="0 0 18 10" fill="none"><path d="M0 10L6 4l4 4L18 0" stroke="white" strokeWidth="2"/></svg>
              </div>
              <span className="text-[14px] font-normal leading-[20px] text-white">+12.4% Avg. Cluster Alpha</span>
            </div>
          </div>

          {/* Right — White card */}
          <div className="bg-white border border-[var(--color-border-light)] p-[28px] md:px-[32px] md:py-[48px] lg:py-[85px] flex flex-col justify-center">
            <svg className="w-[100px] md:w-[282px] h-[30px] mb-[24px]" viewBox="0 0 282 30" fill="var(--color-primary)">
              <rect x="0" y="5" width="30" height="20" rx="2" />
              <rect x="35" y="0" width="30" height="30" rx="2" opacity="0.6" />
              <rect x="70" y="8" width="30" height="14" rx="2" opacity="0.3" />
            </svg>
            <h4 className="font-[var(--font-montaga)] text-[26px] md:text-[length:var(--text-heading)] font-normal leading-[1.2] md:leading-[40px] text-[color:var(--color-text)] mb-[16px] md:mb-[22px]">
              Institutional Security
            </h4>
            <p className="text-[14px] font-normal leading-[23px] text-[color:var(--color-text-secondary)] mb-[24px]">
              Enterprise-grade encryption and SEC-compliant data handling for hedge funds and family offices.
            </p>
            <Link href="/about" className="flex items-center gap-[8px] text-[14px] font-semibold leading-[20px] text-[color:var(--color-primary)] hover:underline">
              Learn More
              <svg className="w-[8px] h-[8px]" viewBox="0 0 8 8" fill="none"><path d="M0 4h6M4 2l2 2-2 2" stroke="var(--color-primary)" strokeWidth="1.5"/></svg>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
