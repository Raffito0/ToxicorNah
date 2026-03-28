export function Charts() {
  return (
    <section className="bg-[var(--color-bg-alt)] py-20">
      <div className="mx-auto max-w-[1200px] px-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--color-muted)] text-center mb-2">
          Market Intelligence
        </p>
        <h2 className="text-3xl text-center text-[color:var(--color-text)] mb-4">
          See the Pattern
        </h2>
        <p className="text-center text-sm text-[color:var(--color-muted)] mb-12 max-w-lg mx-auto">
          Insider buying clusters often precede major price moves.
          Our charts reveal what the data says.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Chart placeholder 1 */}
          <div className="bg-white rounded-lg border border-[var(--color-border)] p-6">
            <h3 className="text-sm font-semibold text-[color:var(--color-text)] mb-4 font-[var(--font-inter)]">
              Insider Buying Volume (90 Days)
            </h3>
            <div className="aspect-[16/9] bg-[var(--color-bg-alt)] rounded flex items-center justify-center text-sm text-[color:var(--color-muted)]">
              TradingView Widget
            </div>
          </div>

          {/* Chart placeholder 2 */}
          <div className="bg-white rounded-lg border border-[var(--color-border)] p-6">
            <h3 className="text-sm font-semibold text-[color:var(--color-text)] mb-4 font-[var(--font-inter)]">
              Top Sectors by Insider Activity
            </h3>
            <div className="aspect-[16/9] bg-[var(--color-bg-alt)] rounded flex items-center justify-center text-sm text-[color:var(--color-muted)]">
              Chart.js Widget
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
