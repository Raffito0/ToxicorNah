export function DetailedAlertCard() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-[1100px] px-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--color-muted)] text-center mb-2">
          Alert Preview
        </p>
        <h2 className="text-3xl text-center text-[color:var(--color-text)] mb-12">
          Every Detail, At a Glance
        </h2>

        <div className="bg-white rounded-xl border border-[var(--color-border)] shadow-lg overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Left — Transaction Data */}
            <div className="p-8 border-b md:border-b-0 md:border-r border-[var(--color-border-light)]">
              <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--color-muted)] mb-6">
                Transaction Data
              </p>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-alt)] flex items-center justify-center text-xs font-bold text-[color:var(--color-muted)]">
                  NVDA
                </div>
                <div>
                  <div className="font-semibold text-sm">NVIDIA Corporation</div>
                  <div className="text-xs text-[color:var(--color-muted)]">
                    NVDA &middot; Technology
                  </div>
                </div>
                <span className="ml-auto inline-block text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--color-accent-green)] text-white">
                  BUY
                </span>
              </div>

              <div className="space-y-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-[color:var(--color-muted)]">Insider</span>
                  <span className="font-medium">Jensen Huang, CEO</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[color:var(--color-muted)]">Amount</span>
                  <span className="font-bold font-[var(--font-mono)] text-[color:var(--color-accent-green)]">
                    $2,298,580
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[color:var(--color-muted)]">Price</span>
                  <span className="font-[var(--font-mono)]">$112.40</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[color:var(--color-muted)]">Shares</span>
                  <span className="font-[var(--font-mono)]">20,450</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[color:var(--color-muted)]">Filed</span>
                  <span>March 24, 2026</span>
                </div>
              </div>
            </div>

            {/* Right — AI Analysis */}
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--color-muted)]">
                  AI Analysis
                </p>
                <span className="inline-block text-[11px] font-bold uppercase px-3 py-1 rounded-full bg-[var(--color-accent-green)]/10 text-[color:var(--color-accent-green)]">
                  High Conviction
                </span>
              </div>

              <div className="space-y-4 text-sm text-[color:var(--color-muted)] leading-relaxed">
                <div>
                  <span className="font-semibold text-[color:var(--color-text)]">Context: </span>
                  Largest CEO purchase since Q2 2024. Previous buy at $78 preceded
                  a 47% rally within 3 months.
                </div>
                <div>
                  <span className="font-semibold text-[color:var(--color-text)]">Historical: </span>
                  First open-market buy in 8 months. Huang&apos;s purchases have
                  a 85% hit rate over 5 years.
                </div>
                <div>
                  <span className="font-semibold text-[color:var(--color-text)]">Sentiment: </span>
                  90-day insider sentiment: 4 buys, 1 sell across NVDA executives.
                </div>
              </div>

              {/* Sentiment bar */}
              <div className="mt-6 p-4 rounded-lg bg-[var(--color-bg-alt)]">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-[color:var(--color-muted)]">Conviction Score</span>
                  <span className="font-bold font-[var(--font-mono)] text-[color:var(--color-accent-green)]">
                    92/100
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-border)]">
                  <div
                    className="h-2 rounded-full bg-[var(--color-accent-green)]"
                    style={{ width: "92%" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
