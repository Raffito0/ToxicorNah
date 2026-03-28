import Link from "next/link";

const FEATURED_REPORTS = [
  {
    ticker: "NVDA",
    title: "NVIDIA Deep Dive",
    pages: "25-page analysis",
    price: "$14.99",
    features: ["Insider buying history (12 mo)", "Financial health breakdown", "Competitor comparison", "AI-powered forecast"],
  },
  {
    ticker: "BUNDLE",
    title: "Magnificent 7 Report",
    pages: "47-page complete analysis",
    price: "$29.99",
    badge: "BEST VALUE",
    features: ["AAPL, NVDA, MSFT, GOOG, AMZN, META, TSLA", "Side-by-side comparison tables", "Sector-wide insider sentiment", "Portfolio allocation signals"],
    primary: true,
  },
  {
    ticker: "INCOME",
    title: "Dividend Kings 2026",
    pages: "30 stocks analyzed",
    price: "$24.99",
    features: ["Top 30 dividend aristocrats", "Yield vs growth analysis", "Insider buying patterns", "Monthly income projections"],
  },
];

export function Reports() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-[1100px] px-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--color-muted)] text-center mb-2">
          Research
        </p>
        <h2 className="text-3xl text-center text-[color:var(--color-text)] mb-3">
          Deep Dive Reports
        </h2>
        <p className="text-center text-sm text-[color:var(--color-muted)] mb-12">
          Comprehensive stock analysis powered by SEC data and AI. One-time purchase, no subscription required.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {FEATURED_REPORTS.map((report) => (
            <div
              key={report.ticker}
              className={`relative bg-white rounded-lg border p-6 flex flex-col ${
                report.primary
                  ? "border-[var(--color-navy)] shadow-md"
                  : "border-[var(--color-border)]"
              }`}
            >
              {report.badge && (
                <span className="absolute -top-3 left-6 inline-block text-[11px] font-bold uppercase px-3 py-1 rounded-full bg-[var(--color-accent-green)] text-white">
                  {report.badge}
                </span>
              )}

              <div className="text-xs font-bold font-[var(--font-mono)] text-[color:var(--color-muted)] mb-3">
                {report.ticker}
              </div>
              <h3 className="text-xl text-[color:var(--color-text)] mb-1">
                {report.title}
              </h3>
              <p className="text-xs text-[color:var(--color-muted)] mb-4">
                {report.pages}
              </p>

              <ul className="space-y-2 mb-6 flex-1">
                {report.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-[color:var(--color-muted)]">
                    <span className="text-[color:var(--color-accent-green)] mt-0.5">&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>

              <div className="text-2xl font-bold font-[var(--font-mono)] text-[color:var(--color-text)] mb-4">
                {report.price}
              </div>

              <button
                className={`w-full h-10 text-sm font-semibold uppercase tracking-wider rounded-lg transition-colors ${
                  report.primary
                    ? "bg-[var(--color-navy)] text-white hover:bg-[var(--color-navy-light)]"
                    : "border border-[var(--color-navy)] text-[color:var(--color-navy)] hover:bg-[var(--color-bg-alt)]"
                }`}
              >
                Download Report
              </button>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <Link
            href="/reports"
            className="text-sm font-medium text-[color:var(--color-link)] hover:underline"
          >
            View all reports &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}
