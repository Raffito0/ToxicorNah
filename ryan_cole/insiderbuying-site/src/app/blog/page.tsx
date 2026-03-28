"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const VERDICT_COLORS: Record<string, { bg: string; text: string }> = {
  BUY: { bg: "#dcfce7", text: "#166534" },
  SELL: { bg: "#fee2e2", text: "#991b1b" },
  CAUTION: { bg: "#fef3c7", text: "#92400e" },
  WAIT: { bg: "#dbeafe", text: "#1e40af" },
  NO_TRADE: { bg: "#f3f4f6", text: "#374151" },
};

interface Article {
  id: number;
  title_text: string;
  slug: string;
  hero_image_url?: string;
  verdict_type: string;
  ticker: string;
  meta_description: string;
  published_at: string;
  word_count: number;
  key_takeaways?: string;
  sector?: string;
  company_name?: string;
  author_name?: string;
}

export default function BlogPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [verdictFilter, setVerdictFilter] = useState("");
  const [tickerSearch, setTickerSearch] = useState("");
  const [nlEmail, setNlEmail] = useState("");
  const [nlSubmitted, setNlSubmitted] = useState(false);
  const [nlLoading, setNlLoading] = useState(false);

  useEffect(() => {
    fetchArticles();
  }, [page, verdictFilter]);

  async function fetchArticles() {
    setLoading(true);
    const params = new URLSearchParams({ blog: "insiderbuying", page: String(page) });
    if (verdictFilter) params.set("verdict_type", verdictFilter);
    if (tickerSearch) params.set("ticker", tickerSearch);

    const res = await fetch(`/api/articles?${params}`);
    if (res.ok) {
      const data = await res.json();
      setArticles(data.list || []);
    }
    setLoading(false);
  }

  function handleSearch() {
    setPage(1);
    fetchArticles();
  }

  async function handleNewsletterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNlLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("newsletter_subscribers")
      .insert({ email: nlEmail, source: "blog" });
    if (error && error.code !== "23505") {
      setNlLoading(false);
      return;
    }
    setNlSubmitted(true);
    setNlLoading(false);
  }

  function formatDate(dateStr: string) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function parseKeyTakeaways(kt?: string): string[] {
    if (!kt) return [];
    try {
      const parsed = JSON.parse(kt);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return (
    <div className="bg-[var(--color-bg-alt)] flex flex-col">

      {/* HEADER */}
      <section className="bg-[var(--color-bg-alt)] pt-[48px] pb-[48px] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[40px]">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-[12px] md:gap-[16px]">
          <p className="text-[12px] font-medium leading-[18px] text-[color:var(--color-text-secondary)]">Insights</p>
          <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[54px] font-normal leading-[1.1] md:leading-[70px] text-[color:var(--color-text)]">Research & Analysis</h1>
          <p className="text-[16px] md:text-[18px] font-normal leading-[26px] md:leading-[29px] text-[color:var(--color-text-secondary)] max-w-[672px]">
            SEC insider trading data. Conviction-scored signals. New research published daily.
          </p>
        </div>
      </section>

      {/* FILTERS */}
      <section className="bg-white border-b border-[#e8eaed] sticky top-[82px] z-40">
        <div className="max-w-[1200px] mx-auto px-[16px] md:px-[32px] flex items-center justify-between h-[60px] md:h-[71px] gap-[16px]">
          <div className="flex items-center gap-[12px]">
            <select
              value={verdictFilter}
              onChange={(e) => { setVerdictFilter(e.target.value); setPage(1); }}
              className="h-[36px] px-[12px] text-[13px] border border-[#d1d6da] rounded bg-white text-[color:var(--color-text)]"
            >
              <option value="">All Verdicts</option>
              {Object.keys(VERDICT_COLORS).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center bg-[var(--color-bg-alt)] rounded h-[36px] px-[14px] gap-[8px]">
            <svg className="w-[14px] h-[14px] text-[color:var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeWidth="2"/><path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round"/></svg>
            <input
              type="text"
              placeholder="Search ticker..."
              value={tickerSearch}
              onChange={(e) => setTickerSearch(e.target.value.toUpperCase().slice(0, 5))}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="bg-transparent text-[14px] text-[color:var(--color-text)] placeholder:text-[#6b7280] outline-none w-[120px]"
            />
          </div>
        </div>
      </section>

      {/* ARTICLES */}
      <section className="max-w-[1200px] mx-auto w-full px-[16px] md:px-[32px] pt-[32px] md:pt-[48px] pb-[48px]">
        {loading ? (
          <div className="text-center py-[48px] text-[color:var(--color-text-secondary)]">Loading articles...</div>
        ) : articles.length === 0 ? (
          <div className="text-center py-[48px] text-[color:var(--color-text-secondary)]">No articles found.</div>
        ) : (
          <>
            {/* Featured (first article) */}
            {articles.length > 0 && (
              <div className="flex flex-col md:flex-row gap-[20px] md:gap-[32px] md:items-center mb-[48px] md:mb-[80px]">
                <div className="w-full md:w-[387px] h-[200px] md:h-[217px] bg-[var(--color-border)] shrink-0 overflow-hidden">
                  {articles[0].hero_image_url && (
                    <img src={articles[0].hero_image_url} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex flex-col gap-[8px] md:gap-[11px]">
                  <div className="flex items-center gap-[8px]">
                    <span
                      className="text-[12px] font-bold px-[8px] py-[2px] rounded"
                      style={{
                        backgroundColor: VERDICT_COLORS[articles[0].verdict_type]?.bg || "#f3f4f6",
                        color: VERDICT_COLORS[articles[0].verdict_type]?.text || "#374151",
                      }}
                    >
                      {articles[0].verdict_type}
                    </span>
                    <span className="text-[11px] font-medium text-[color:var(--color-text-secondary)]">{articles[0].ticker}</span>
                  </div>
                  <Link href={`/blog/${articles[0].slug}`}>
                    <h2 className="font-[var(--font-montaga)] text-[24px] md:text-[30px] font-normal leading-[1.25] md:leading-[38px] text-[color:var(--color-text)] hover:text-[color:var(--color-primary)] transition-colors">
                      {articles[0].title_text}
                    </h2>
                  </Link>
                  <p className="text-[15px] md:text-[16px] font-normal leading-[24px] md:leading-[26px] text-[color:var(--color-text-secondary)]">
                    {articles[0].meta_description}
                  </p>
                  <div className="flex items-center gap-[12px] mt-[8px]">
                    <span className="text-[12px] text-[color:var(--color-text-secondary)]">{articles[0].author_name}</span>
                    <span className="text-[12px] text-[color:var(--color-text-secondary)]">{formatDate(articles[0].published_at)}</span>
                    <span className="text-[12px] text-[color:var(--color-text-secondary)]">{Math.ceil((articles[0].word_count || 0) / 200)} min read</span>
                  </div>
                </div>
              </div>
            )}

            {/* Grid (remaining articles) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--gap-cards)] md:gap-[48px]">
              {articles.slice(1).map((a) => (
                <div key={a.id} className="flex flex-col">
                  <div className="w-full aspect-[16/9] bg-[var(--color-border)] mb-[12px] overflow-hidden">
                    {a.hero_image_url && (
                      <img src={a.hero_image_url} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex items-center gap-[8px] mb-[4px]">
                    <span
                      className="text-[12px] font-bold px-[6px] py-[1px] rounded"
                      style={{
                        backgroundColor: VERDICT_COLORS[a.verdict_type]?.bg || "#f3f4f6",
                        color: VERDICT_COLORS[a.verdict_type]?.text || "#374151",
                      }}
                    >
                      {a.verdict_type}
                    </span>
                    <span className="text-[11px] font-medium text-[color:var(--color-text-secondary)] font-mono">{a.ticker}</span>
                  </div>
                  <Link href={`/blog/${a.slug}`}>
                    <h3 className="font-[var(--font-montaga)] text-[20px] md:text-[22px] font-normal leading-[1.25] md:leading-[28px] text-[color:var(--color-text)] hover:text-[color:var(--color-primary)] transition-colors mb-[8px]">
                      {a.title_text}
                    </h3>
                  </Link>
                  <p className="text-[14px] font-normal leading-[20px] text-[color:var(--color-text-secondary)] mb-[8px] line-clamp-2">{a.meta_description}</p>
                  <div className="flex items-center gap-[8px] pt-[8px]">
                    <span className="text-[12px] text-[color:var(--color-text-secondary)]">{a.author_name}</span>
                    <span className="text-[12px] text-[color:var(--color-text-secondary)]">{formatDate(a.published_at)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex justify-center gap-[12px] pt-[32px]">
              {page > 1 && (
                <button onClick={() => setPage(page - 1)} className="h-[46px] px-[24px] rounded border border-[#d1d6da] text-[14px] font-bold text-[color:var(--color-text)] hover:bg-[var(--color-bg-alt)]">
                  Previous
                </button>
              )}
              {articles.length === 12 && (
                <button onClick={() => setPage(page + 1)} className="h-[46px] px-[24px] rounded border border-[#d1d6da] text-[14px] font-bold text-[color:var(--color-text)] hover:bg-[var(--color-bg-alt)]">
                  Next
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* NEWSLETTER */}
      <section className="bg-[var(--color-navy)] pt-[48px] pb-[48px] md:pt-[var(--section-y-mobile)] md:pb-[var(--section-y-mobile)] px-[20px] md:px-[40px]">
        <div className="max-w-[1200px] mx-auto flex flex-col lg:flex-row items-start lg:items-center justify-between gap-[var(--gap-items)] lg:gap-[64px]">
          <div className="flex flex-col gap-[8px]">
            <h2 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[36px] text-white">Subscribe to the Briefing</h2>
            <p className="text-[15px] md:text-[16px] font-normal leading-[24px] text-white">
              Receive exclusive weekly analysis directly to your terminal. No noise, just architectural precision.
            </p>
          </div>
          {nlSubmitted ? (
            <p className="text-[16px] text-white">Subscribed! Check <strong>{nlEmail}</strong> for updates.</p>
          ) : (
            <form onSubmit={handleNewsletterSubmit} className="flex flex-col sm:flex-row gap-[8px] w-full sm:w-auto shrink-0">
              <input type="email" required value={nlEmail} onChange={(e) => setNlEmail(e.target.value)} placeholder="Email Address" className="w-full sm:w-[300px] h-[48px] bg-white px-[24px] text-[16px] text-[color:var(--color-text)] placeholder:text-[#6b7280]" />
              <button type="submit" disabled={nlLoading} className="h-[48px] px-[32px] bg-white text-[16px] font-medium text-[color:var(--color-text)] hover:bg-white/90 disabled:opacity-50">
                {nlLoading ? "..." : "Subscribe"}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
