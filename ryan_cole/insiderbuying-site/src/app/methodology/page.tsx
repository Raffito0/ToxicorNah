import type { Metadata } from "next";
import Link from "next/link";
import { buildWebPageJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  title: "Methodology | EarlyInsider",
  description:
    "Our data-driven methodology: how we source SEC filings, score insider trades, and generate institutional-grade stock analysis reports.",
};

const DATA_SOURCES = [
  { icon: "📄", title: "SEC Edgar Filings", desc: "Real-time monitoring of all Form 4, 13F, and Schedule 13D filings with automated parsing and classification of transaction types.", footer: "Primary source for all insider trading data" },
  { icon: "📊", title: "Financial Datasets API", desc: "Comprehensive financial data including income statements, balance sheets, cash flow, key ratios, and 10-year historical price data.", footer: "financialdatasets.ai \u2014 trusted by hedge funds" },
  { icon: "📰", title: "Market Intelligence", desc: "Earnings call transcripts, analyst consensus estimates, and real-time news feeds cross-referenced with insider filing timestamps.", footer: "Verified citations with page numbers" },
];

const STEPS = [
  { num: "STEP 01", title: "Data Collection", desc: "Automated pipelines continuously monitor SEC EDGAR for new Form 4 filings. Each filing is parsed, validated, and enriched with company fundamentals within 2\u20134 minutes." },
  { num: "STEP 02", title: "Noise Filtering", desc: "80% of Form 4 filings are routine: scheduled 10b5-1 plan executions, small option exercises, and tax withholding. The filtering engine classifies each transaction against 14 criteria to isolate the 20% that reflect discretionary conviction." },
  { num: "STEP 03", title: "Conviction Scoring", desc: "Each filing that passes the noise filter receives a conviction score from 0 to 100. The scoring model weighs 7 factors including trade size, executive track record, cluster activity, and sector context. A 14-point quality gate ensures publication standards." },
  { num: "STEP 04", title: "Quality Gate", desc: "Automated checks verify title length, meta descriptions, banned phrase detection, keyword placement, and verdict validation before any article is published." },
];

const LIMITATIONS = [
  { icon: "", text: "Mandatory reporting lag. SEC Form 4 filings must be submitted within 2 business days of the transaction. EarlyInsider detects filings within seconds of SEC EDGAR publication, but the underlying trade may have occurred up to 48 hours earlier." },
  { icon: "", text: "10b5-1 pre-planned trades. Insiders who file trades under Rule 10b5-1 plans execute on a predetermined schedule, not in response to current information. The noise filter flags known 10b5-1 transactions, but not all plans are publicly disclosed." },
  { icon: "", text: "AI analysis scope. The analysis engine operates on public data only: SEC filings, market prices, historical fundamentals, and corporate event calendars. It cannot assess management sentiment from private communications or pending regulatory actions." },
  { icon: "", text: "Historical performance is not predictive. Academic research demonstrates that insider purchases have historically outperformed market benchmarks. Past patterns do not guarantee future results for any individual filing or trade." },
];

const methodologyJsonLd = buildWebPageJsonLd({
  name: "Methodology | EarlyInsider",
  description: "Our data-driven methodology: how we source SEC filings, score insider trades, and generate institutional-grade stock analysis reports.",
  url: "https://earlyinsider.com/methodology",
});

export default function MethodologyPage() {
  return (
    <div className="bg-[var(--color-bg-alt)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(methodologyJsonLd) }}
      />

      {/* ═══ SECTION 1: HEADER ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-hero-mobile)] pb-[var(--section-y-hero-mobile)] md:pt-[var(--section-y-hero)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[32px]">
        <div className="max-w-[1100px] mx-auto">
          <p className="text-[12px] font-normal leading-[18px] tracking-[0.5px] text-[color:var(--color-text-muted)] mb-[16px]">TRANSPARENCY</p>
          <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[length:var(--text-display)] font-normal leading-[1.1] md:leading-[60px] text-[color:var(--color-text)] mb-[16px]">
            How We Analyze
          </h1>
          <p className="text-[17px] md:text-[18px] font-normal leading-[28px] md:leading-[32px] text-[color:var(--color-text-secondary)] max-w-[672px] pt-[8px] md:pt-[16px]">
            Every number in our articles comes from a verifiable source. Here&apos;s exactly how our research process works to ensure institutional-grade precision.
          </p>
        </div>
      </section>

      {/* ═══ SECTION 2: DATA SOURCES ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[1100px] mx-auto">
          <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[36px] text-[color:var(--color-text)] mb-[40px] md:mb-[64px]">
            Our Data Sources
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[20px] md:gap-[32px]">
            {DATA_SOURCES.map((src) => (
              <div key={src.title} className="bg-[var(--color-bg-alt)] border border-black/10 p-[28px] md:p-[40px] flex flex-col">
                <span className="text-[24px] mb-[20px] md:mb-[24px]">{src.icon}</span>
                <h3 className="text-[length:var(--text-subheading)] font-bold leading-[28px] text-[color:var(--color-text)] mb-[12px] md:mb-[16px]">{src.title}</h3>
                <p className="text-[14px] font-normal leading-[23px] text-[color:var(--color-text)] mb-[24px] flex-1">{src.desc}</p>
                <div className="pt-[20px] md:pt-[24px] border-t border-[var(--color-border)]">
                  <p className="text-[12px] font-normal leading-[16px] text-[color:var(--color-primary)]">{src.footer}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 3: ANALYSIS PROCESS (SIMPLE VERTICAL ON ALL SCREENS) ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[1024px] mx-auto">
          <h2 className="font-[var(--font-montaga)] text-[26px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[36px] text-[color:var(--color-text)] text-center mb-[48px] md:mb-[80px]">
            Our Analysis Process
          </h2>
          <div className="relative max-w-[600px] mx-auto">
            {/* Vertical line */}
            <div className="absolute left-[6px] md:left-[6px] top-0 bottom-0 w-[1px] bg-[var(--color-border)]" />
            <div className="flex flex-col gap-[48px] md:gap-[64px]">
              {STEPS.map((step) => (
                <div key={step.num} className="flex gap-[24px] md:gap-[32px]">
                  <div className="relative z-10 w-[12px] h-[12px] rounded-full bg-[var(--color-primary)] border-[4px] border-[var(--color-bg-alt)] shadow-[0px_0px_0px_2px_rgba(0,0,0,0.05)] shrink-0 mt-[4px]" />
                  <div>
                    <p className="text-[12px] font-bold leading-[20px] tracking-[2px] text-[color:var(--color-primary)] uppercase mb-[6px]">{step.num}</p>
                    <h3 className="text-[20px] md:text-[length:var(--text-heading)] font-bold leading-[1.3] md:leading-[32px] text-[color:var(--color-text)] mb-[8px]">{step.title}</h3>
                    <p className="text-[15px] md:text-[16px] font-normal leading-[24px] md:leading-[26px] text-[color:var(--color-text-secondary)]">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4: AI TRANSPARENCY ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[836px] mx-auto pl-[24px] md:pl-[64px] border-l border-[var(--color-primary)]">
          <h2 className="font-[var(--font-montaga)] text-[24px] md:text-[length:var(--text-title)] font-normal leading-[1.3] md:leading-[36px] text-[color:var(--color-text)] mb-[24px] md:mb-[32px]">
            We Use AI — And We&apos;re Transparent About It
          </h2>
          <div className="flex flex-col gap-[20px] md:gap-[24px]">
            <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[29px] text-[color:var(--color-text-secondary)]">
              The analysis engine uses large language models to generate plain-English filing context, research report narratives, and conviction score explanations. The models operate exclusively on structured data extracted from SEC filings and verified financial datasets. No model has access to material nonpublic information.
            </p>
            <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[29px] text-[color:var(--color-text-secondary)]">
              Every AI-generated narrative is constrained by the underlying structured data. If the filing data says the CEO purchased 50,000 shares at $34.12, the narrative cannot state a different figure. Conviction scores are computed algorithmically from 7 weighted factors; the language model explains the score but does not determine it.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5: LIMITATIONS ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[900px] mx-auto">
          <h2 className="font-[var(--font-montaga)] text-[24px] md:text-[length:var(--text-title)] font-normal leading-[1.3] md:leading-[36px] text-[color:var(--color-text)] mb-[28px] md:mb-[40px]">
            Limitations
          </h2>
          <div className="bg-white shadow-[0px_1px_3px_rgba(0,0,0,0.06)] p-[24px] md:p-[48px]">
            <div className="flex flex-col gap-[20px] md:gap-[24px]">
              {LIMITATIONS.map((item, i) => (
                <div key={i} className="flex gap-[12px] md:gap-[16px]">
                  <span className="text-[16px] shrink-0 pt-[2px]">{item.icon}</span>
                  <p className="text-[15px] md:text-[16px] font-normal leading-[24px] text-[color:var(--color-text-secondary)]">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 6: VERIFY OUR DATA ═══ */}
      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[900px] mx-auto text-center">
          <h2 className="font-[var(--font-montaga)] text-[24px] md:text-[length:var(--text-title)] font-normal leading-[1.3] md:leading-[36px] text-[color:var(--color-text)] mb-[16px]">
            Verify Our Data
          </h2>
          <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[28px] text-[color:var(--color-text-secondary)] mb-[24px] md:mb-[32px]">
            Every data point in our articles can be independently verified.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[16px] md:gap-[24px]">
            {[
              { title: "SEC EDGAR Database", desc: "Search official government filings directly to cross-reference our analysis." },
              { title: "Financial Datasets API", desc: "Review the documentation for the institutional data layer powering our platform." },
            ].map((link) => (
              <a key={link.title} href="#" className="bg-[var(--color-bg-alt)] p-[24px] md:p-[32px] text-left hover:bg-[#eae7e7] transition-colors group">
                <div className="flex items-center justify-between mb-[12px] md:mb-[16px]">
                  <h3 className="text-[18px] md:text-[20px] font-bold leading-[28px] text-[color:var(--color-text)]">{link.title}</h3>
                  <svg className="w-[16px] h-[16px] text-[color:var(--color-text-secondary)] group-hover:translate-x-[2px] transition-transform shrink-0 ml-[8px]" viewBox="0 0 16 16" fill="none">
                    <path d="M4 12L12 4M12 4H6M12 4v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="text-[14px] font-normal leading-[20px] text-[color:var(--color-text-secondary)]">{link.desc}</p>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
