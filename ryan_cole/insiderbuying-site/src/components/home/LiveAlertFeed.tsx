const MOCK_ALERTS = [
  { name: "Jensen Huang", role: "CEO", company: "NVIDIA", ticker: "NVDA", amount: "$2,298,580", type: "BUY" as const, time: "2 hours ago", photo: "/images/jensen.jpg" },
  { name: "Tim Cook", role: "CEO", company: "Apple", ticker: "AAPL", amount: "$1,450,000", type: "BUY" as const, time: "4 hours ago", photo: "/images/tim.jpg" },
  { name: "Satya Nadella", role: "CEO", company: "Microsoft", ticker: "MSFT", amount: "$3,100,000", type: "BUY" as const, time: "6 hours ago", photo: "/images/satya.jpg" },
  { name: "Andy Jassy", role: "CEO", company: "Amazon", ticker: "AMZN", amount: "$980,000", type: "SELL" as const, time: "8 hours ago", photo: "/images/andy.jpg" },
  { name: "Mark Zuckerberg", role: "CEO", company: "Meta", ticker: "META", amount: "$4,200,000", type: "BUY" as const, time: "12 hours ago", photo: "/images/mark.jpg" },
];

export function LiveAlertFeed() {
  return (
    <section className="bg-[var(--color-bg-alt)] py-20">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="flex items-center gap-3 mb-8">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--color-accent-green)] bg-white border border-[var(--color-border)] rounded-full px-4 py-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent-green)] animate-pulse" />
            LIVE
          </span>
          <h2 className="text-3xl text-[color:var(--color-text)]">
            Latest Insider Activity
          </h2>
        </div>

        <div className="space-y-3">
          {MOCK_ALERTS.map((alert, i) => (
            <div
              key={i}
              className="flex items-center gap-4 bg-white rounded-lg border border-[var(--color-border)] p-4 hover:shadow-sm transition-shadow"
            >
              {/* Photo placeholder */}
              <div className="w-12 h-12 rounded-full bg-[var(--color-bg-alt)] shrink-0 overflow-hidden">
                <div className="w-full h-full flex items-center justify-center text-xs text-[color:var(--color-muted)]">
                  {alert.name.split(" ").map(n => n[0]).join("")}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-[color:var(--color-text)]">
                    {alert.name}
                  </span>
                  <span className="text-xs text-[color:var(--color-muted)]">
                    {alert.role} &middot; {alert.company}
                  </span>
                </div>
                <span className="text-xs text-[color:var(--color-muted)] font-[var(--font-mono)]">
                  {alert.ticker}
                </span>
              </div>

              {/* Amount + type */}
              <div className="text-right shrink-0">
                <span
                  className={`inline-block text-[11px] font-bold uppercase px-2 py-0.5 rounded mb-1 ${
                    alert.type === "BUY"
                      ? "bg-[var(--color-accent-green)] text-white"
                      : "bg-[var(--color-accent-red)] text-white"
                  }`}
                >
                  {alert.type}
                </span>
                <div
                  className={`text-lg font-bold font-[var(--font-mono)] ${
                    alert.type === "BUY"
                      ? "text-[color:var(--color-accent-green)]"
                      : "text-[color:var(--color-accent-red)]"
                  }`}
                >
                  {alert.amount}
                </div>
              </div>

              {/* Time */}
              <span className="text-xs text-[color:var(--color-muted)] shrink-0 hidden sm:block">
                {alert.time}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-[color:var(--color-muted)]">
          Source: SEC Form 4 Filings. Data updated every 15 seconds.
        </p>
      </div>
    </section>
  );
}
