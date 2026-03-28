"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface InsiderAlert {
  id: string;
  ticker: string;
  company_name: string;
  insider_name: string;
  insider_title: string;
  transaction_type: string;
  shares: number;
  price_per_share: number;
  total_value: number;
  filing_date: string;
  significance_score: number;
  ai_analysis: string | null;
  cluster_id: string | null;
  is_cluster_buy: boolean;
  raw_filing_data: unknown;
  created_at: string;
}

interface AlertDisplay {
  name: string;
  title: string;
  company: string;
  type: "buy" | "sell";
  amount: string;
  time: string;
  ai: string;
  isSample?: boolean;
}

const SAMPLE_ALERTS: AlertDisplay[] = [
  { name: "Michael R. Bloomberg", title: "CEO", company: "Enterprise Tech Solutions (ETS)", type: "buy", amount: "$1,240,500", time: "2 minutes ago", ai: "Significant insider purchase relative to previous holding patterns. Purchase occurs 48 hours before quarterly earnings release, suggesting high internal confidence in pending data points. Transaction size represents 12% of total annual compensation...", isSample: true },
  { name: "Sarah Jenkins", title: "CFO", company: "CloudStream Dynamics (CSD)", type: "sell", amount: "$450,200", time: "14 minutes ago", ai: "Automatic divestment plan execution (Rule 10b5-1). Minimal impact on overall holding percentages. Transaction appears to be part of a scheduled tax-minimization strategy rather than organic bearish sentiment...", isSample: true },
  { name: "David Chen", title: "Director", company: "Meridian Systems (MSYS)", type: "buy", amount: "$2.4M", time: "45 minutes ago", ai: "", isSample: true },
];

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`.replace(".0K", "K");
  return `$${value.toLocaleString()}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function mapAlert(row: InsiderAlert): AlertDisplay {
  const txType = row.transaction_type?.toLowerCase();
  return {
    name: row.insider_name,
    title: row.insider_title,
    company: `${row.company_name} (${row.ticker})`,
    type: txType === "sell" || txType === "sale" ? "sell" : "buy",
    amount: formatCurrency(row.total_value),
    time: timeAgo(row.created_at),
    ai: row.ai_analysis || "",
  };
}

const TOP_BUYS = [
  { ticker: "NVDA", label: "NVIDIA", amount: "$14.2M" },
  { ticker: "META", label: "Meta", amount: "$8.9M" },
  { ticker: "LMT", label: "Lockheed", amount: "$4.1M" },
  { ticker: "AMAT", label: "Applied M.", amount: "$2.8M" },
  { ticker: "SBUX", label: "Starbucks", amount: "$1.2M" },
];

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertDisplay[]>(SAMPLE_ALERTS);
  const [isSampleData, setIsSampleData] = useState(true);
  const [isPro, setIsPro] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    const supabase = createClient();

    // Fetch initial alerts
    supabase
      .from("insider_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setAlerts(data.map(mapAlert));
          setIsSampleData(false);
        }
        // If empty or error, keep sample data
      });

    // Check subscription tier
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setIsLoggedIn(true);
      supabase
        .from("profiles")
        .select("subscription_tier")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.subscription_tier === "pro") {
            setIsPro(true);
          }
        });
    }).catch(() => {
      // Auth unreachable — stay blurred (safe default)
    });

    // Subscribe to realtime INSERTs
    const channel = supabase
      .channel("insider_alerts_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "insider_alerts" },
        (payload) => {
          const newAlert = mapAlert(payload.new as InsiderAlert);
          setAlerts((prev) => [newAlert, ...prev]);
          setIsSampleData(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="bg-[var(--color-bg-alt)] min-h-screen pb-[80px] md:pb-[64px]">

      {/* ═══ HEADER ═══ */}
      <section className="bg-[var(--color-bg-alt)] pt-[40px] md:pt-[60px] pb-[32px] md:pb-[40px]">
        <div className="max-w-[1280px] mx-auto px-[20px] md:px-[32px] flex flex-col md:flex-row md:items-end md:justify-between gap-[16px]">
          <div>
            <p className="text-[12px] font-semibold leading-[18px] text-[color:var(--color-text-muted)] uppercase tracking-wider mb-[4px]">Real-Time Data</p>
            <h1 className="font-[var(--font-montaga)] text-[32px] md:text-[length:var(--text-title)] font-normal leading-[1.2] md:leading-[52px] text-[color:var(--color-text)] mb-[4px]">Live Insider Activity</h1>
            <p className="text-[15px] md:text-[16px] font-normal leading-[24px] md:leading-[27px] text-[color:var(--color-text-secondary)] opacity-80">Every SEC Form 4 filing, analyzed by AI within 60 seconds.</p>
          </div>
          <div className="flex items-center gap-[12px] bg-white px-[16px] py-[8px] shadow-sm self-start md:self-auto">
            <div className="relative w-[12px] h-[12px]">
              <div className="absolute inset-0 bg-[var(--color-signal-green)] rounded-full opacity-75" />
              <div className="absolute inset-[2px] bg-[var(--color-signal-green)] rounded-full" />
            </div>
            <span className="text-[12px] font-medium leading-[16px] text-[color:var(--color-signal-green)]">LIVE</span>
          </div>
        </div>
      </section>

      {/* ═══ FILTER BAR ═══ */}
      <section className="bg-white border-b border-[var(--color-border)] sticky top-[82px] z-40 overflow-x-auto">
        <div className="max-w-[1280px] mx-auto px-[16px] md:px-[32px] h-[56px] flex items-center gap-[12px] md:gap-[16px] min-w-max">
          <div className="flex items-center gap-[8px] pl-[8px] md:pl-[16px]">
            <svg className="w-[12px] h-[8px]" viewBox="0 0 12 8" fill="#757688"><path d="M0 0h12M2 4h8M4 8h4" stroke="#757688" strokeWidth="2"/></svg>
            <span className="text-[13px] md:text-[14px] font-medium leading-[20px] text-[color:var(--color-text-muted)]">Filters</span>
          </div>
          {["All Roles","All Sectors","Min Amount","Time Range"].map((f) => (
            <button key={f} className="h-[36px] px-[10px] md:px-[12px] flex items-center gap-[6px] md:gap-[8px] border border-[var(--color-border)] bg-white text-[13px] md:text-[14px] font-normal leading-[20px] text-[color:var(--color-text)] whitespace-nowrap">
              {f}
              <svg className="w-[8px] h-[4px]" viewBox="0 0 8 4" fill="none"><path d="M0 0l4 4 4-4" stroke="#6b7280" strokeWidth="1"/></svg>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-[8px]">
            <span className="text-[12px] font-normal leading-[16px] text-[color:var(--color-text-muted)] hidden md:inline">Sort by:</span>
            <button className="h-[36px] px-[10px] md:px-[12px] flex items-center gap-[6px] md:gap-[8px] border border-[var(--color-border)] bg-white text-[13px] md:text-[14px] font-medium leading-[20px] text-[color:var(--color-text)] whitespace-nowrap">
              Most Recent
              <svg className="w-[8px] h-[4px]" viewBox="0 0 8 4" fill="none"><path d="M0 0l4 4 4-4" stroke="#6b7280" strokeWidth="1"/></svg>
            </button>
          </div>
        </div>
      </section>

      {/* ═══ MAIN CONTENT ═══ */}
      <section className="max-w-[1280px] mx-auto px-[16px] md:px-[32px] pt-[24px] md:pt-[48px] pb-[48px]">
        <div className="flex gap-[48px]">

          {/* ALERT FEED */}
          <div className="flex-1 max-w-[888px] flex flex-col gap-[16px] md:gap-[24px]">
            {isSampleData && (
              <div className="bg-[#f0edf6] border border-[var(--color-border)] px-[16px] py-[10px] text-[13px] font-medium leading-[20px] text-[color:var(--color-text-secondary)] text-center">
                Sample data &mdash; live alerts coming soon
              </div>
            )}
            {alerts.map((a, i) => (
              <div key={i} className={`bg-white border border-[var(--color-border)] p-[16px] md:p-[24px] flex flex-col gap-[16px] md:gap-[24px] ${a.isSample && !a.ai ? "opacity-60" : ""}`}>
                {/* Top row: avatar + name + badge + amount */}
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-[12px]">
                  <div className="flex items-center gap-[12px] md:gap-[16px]">
                    <div className="w-[40px] h-[40px] md:w-[48px] md:h-[48px] rounded-full bg-[var(--color-border)] flex items-center justify-center text-[12px] md:text-[13px] font-semibold text-[color:var(--color-text-muted)] shrink-0">
                      {a.name.split(" ").map(n => n[0]).join("").slice(0,2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] md:text-[18px] font-semibold leading-[24px] md:leading-[28px] text-[color:var(--color-text)]">{a.name}</p>
                      <p className="text-[13px] md:text-[14px] font-normal leading-[20px] text-[color:var(--color-text-muted)]">{a.title} &bull; {a.company}</p>
                    </div>
                    {/* Badge + amount inline on mobile next to name */}
                    <div className="text-right shrink-0 md:hidden">
                      <span className={`inline-block text-[12px] font-bold leading-[16px] px-[10px] py-[3px] rounded-[2px] mb-[2px] ${
                        a.type === "buy" ? "bg-[#c4e6d0] text-[#007237]" : "bg-[#ffdad6] text-[#93000a]"
                      }`}>
                        {a.type.toUpperCase()}
                      </span>
                      <p className={`text-[16px] font-semibold leading-[22px] ${a.type === "buy" ? "text-[color:var(--color-signal-green)]" : "text-[#ba1a1a]"}`}>
                        {a.amount}
                      </p>
                    </div>
                  </div>
                  {/* Desktop badge + amount */}
                  <div className="text-right shrink-0 hidden md:block">
                    <span className={`inline-block text-[12px] font-bold leading-[16px] px-[12px] py-[4px] rounded-[2px] mb-[8px] ${
                      a.type === "buy" ? "bg-[#c4e6d0] text-[#007237]" : "bg-[#ffdad6] text-[#93000a]"
                    }`}>
                      {a.type.toUpperCase()}
                    </span>
                    <p className={`text-[24px] font-semibold leading-[32px] ${a.type === "buy" ? "text-[color:var(--color-signal-green)]" : "text-[#ba1a1a]"}`}>
                      {a.amount}
                    </p>
                  </div>
                </div>

                {/* AI Analysis (blurred) */}
                {a.ai && (
                  <div className="relative bg-[var(--color-bg-alt)] p-[16px] md:p-[24px]">
                    <div className="flex items-center gap-[8px] mb-[8px]">
                      <svg className="w-[13px] h-[14px]" viewBox="0 0 13 14" fill="#000592"><rect width="13" height="14" rx="2"/></svg>
                      <span className="text-[12px] font-bold leading-[16px] text-[color:var(--color-primary)]">AI Sentiment Analysis</span>
                    </div>
                    <div className="relative">
                      <p className={`text-[13px] md:text-[14px] font-normal leading-[22px] text-[color:var(--color-text)] ${!isPro ? "blur-[4px] select-none" : ""}`}>{a.ai}</p>
                      {!isPro && (
                        <div className="absolute inset-0 bg-[var(--color-bg-alt)]/60 flex flex-col items-center justify-center">
                          <svg className="w-[14px] h-[19px] mb-[8px]" viewBox="0 0 14 19" fill="#1c1b1b"><path d="M7 0a5 5 0 00-5 5v3H1a1 1 0 00-1 1v9a1 1 0 001 1h12a1 1 0 001-1V9a1 1 0 00-1-1h-1V5a5 5 0 00-5-5zm3 8V5a3 3 0 10-6 0v3h6z"/></svg>
                          <p className="text-[13px] md:text-[14px] font-medium leading-[20px] text-[color:var(--color-text)] text-center">
                            {!isLoggedIn ? "Sign up for free to unlock AI analysis" : "Upgrade to Analyst for instant AI analysis"}
                          </p>
                          <Link href={!isLoggedIn ? "/signup" : "/pricing"} className="text-[12px] font-medium leading-[16px] text-[color:var(--color-primary)] mt-[4px]">
                            {!isLoggedIn ? "Sign up free" : "Unlock this insight"} &rarr;
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!a.ai && (
                  <div className="bg-[var(--color-bg-alt)] h-[80px]" />
                )}

                {/* Footer */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-normal leading-[16px] text-[color:var(--color-text-muted)]">{a.time} &bull; SEC Form 4</span>
                  <Link href="/pricing" className="flex items-center gap-[3px] text-[13px] md:text-[14px] font-medium leading-[20px] text-[color:var(--color-primary)] hover:underline">
                    Full Analysis
                    <svg className="w-[8px] h-[8px]" viewBox="0 0 8 8" fill="#000592"><path d="M0 4h6M4 2l2 2-2 2" stroke="#000592" strokeWidth="1.5" fill="none"/></svg>
                  </Link>
                </div>
              </div>
            ))}

            {/* Load More */}
            <div className="pt-[24px] md:pt-[32px] flex justify-center">
              <button className="h-[50px] px-[32px] border border-[var(--color-border)] text-[15px] md:text-[16px] font-medium leading-[24px] text-[color:var(--color-text)] hover:bg-[var(--color-bg-alt)] transition-colors w-full md:w-auto">
                Load More Activity
              </button>
            </div>
          </div>

          {/* SIDEBAR — hidden on mobile */}
          <aside className="w-[280px] shrink-0 hidden lg:flex flex-col gap-[24px]">
            {/* Watchlist */}
            <div className="bg-white border border-[var(--color-border)] p-[24px]">
              <div className="flex items-center gap-[8px] mb-[16px]">
                <svg className="w-[17px] h-[16px]" viewBox="0 0 17 16" fill="#000592"><path d="M8.5 0l2.5 5.5H17l-4.5 3.5 1.5 6L8.5 12 3 15l1.5-6L0 5.5h6z"/></svg>
                <span className="font-[var(--font-montaga)] text-[length:var(--text-subheading)] font-normal leading-[24px] text-[color:var(--color-text)]">Your Watchlist</span>
              </div>
              <div className="bg-[var(--color-bg-alt)] border border-[var(--color-border)] py-[32px] px-[16px] text-center">
                <p className="text-[12px] font-normal leading-[16px] text-[color:var(--color-text-muted)] mb-[16px]">Track specific companies and get<br />instant push alerts.</p>
                <button className="bg-[var(--color-primary)] text-white text-[12px] font-bold leading-[16px] px-[16px] py-[8px]">Create Watchlist</button>
              </div>
            </div>

            {/* Top Buys */}
            <div className="bg-white border border-[var(--color-border)] p-[24px]">
              <div className="flex items-center gap-[8px] mb-[24px]">
                <svg className="w-[18px] h-[10px]" viewBox="0 0 18 10" fill="#006d34"><path d="M0 10L6 4l4 4L18 0" stroke="#006d34" strokeWidth="2" fill="none"/></svg>
                <span className="font-[var(--font-montaga)] text-[length:var(--text-subheading)] font-normal leading-[24px] text-[color:var(--color-text)]">This Week&apos;s Top Buys</span>
              </div>
              <div className="flex flex-col gap-[16px]">
                {TOP_BUYS.map((b) => (
                  <div key={b.ticker} className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-bold leading-[16px] text-[color:var(--color-text)] font-[var(--font-mono)]">{b.ticker}</p>
                      <p className="text-[12px] font-normal leading-[15px] text-[color:var(--color-text-muted)]">{b.label}</p>
                    </div>
                    <span className="text-[12px] font-semibold leading-[16px] text-[color:var(--color-signal-green)]">{b.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* ═══ BOTTOM BAR (STICKY) ═══ */}
      <section className="fixed bottom-0 left-0 right-0 bg-[#000232] h-auto md:h-[64px] z-50 shadow-[0px_-2px_8px_rgba(0,0,0,0.15)]">
        <div className="max-w-[1280px] mx-auto px-[16px] md:px-[32px] h-full flex flex-col md:flex-row items-center justify-between py-[12px] md:py-0 gap-[10px] md:gap-0">
          <div className="flex items-center gap-[8px] md:gap-[12px]">
            <svg className="w-[18px] h-[18px] shrink-0" viewBox="0 0 18 18" fill="#777eff"><circle cx="9" cy="9" r="9"/><path d="M9 5v4M9 11v1" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
            <p className="text-[12px] md:text-[14px] font-medium leading-[18px] md:leading-[20px] text-white">
              Alerts delayed by <span className="font-bold">15 min</span>. Analyst = real-time.
            </p>
          </div>
          <Link href="/pricing" className="flex items-center gap-[7px] bg-[var(--color-primary)] h-[36px] md:h-[40px] px-[20px] md:px-[24px] text-[14px] md:text-[16px] font-medium leading-[24px] text-white hover:bg-[var(--color-primary-dark)] transition-colors shrink-0">
            Get Unlimited Alerts
            <svg className="w-[8px] h-[10px]" viewBox="0 0 8 10" fill="white"><path d="M0 0l8 5-8 5z"/></svg>
          </Link>
        </div>
      </section>
    </div>
  );
}
