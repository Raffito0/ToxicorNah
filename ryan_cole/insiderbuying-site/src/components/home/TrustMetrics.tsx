const METRICS = [
  { value: "$4.2B", label: "Insider Transactions Tracked" },
  { value: "2,847", label: "Companies Monitored" },
  { value: "17,325+", label: "SEC Filings Analyzed" },
];

export function TrustMetrics() {
  return (
    <section className="bg-[var(--color-bg-alt)] py-16">
      <div className="mx-auto max-w-[1100px] px-6">
        <div className="flex flex-col md:flex-row items-center justify-center gap-12 md:gap-20">
          {METRICS.map((metric, i) => (
            <div key={metric.value} className="flex items-center gap-12 md:gap-20">
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-bold font-[var(--font-mono)] text-[color:var(--color-text)]">
                  {metric.value}
                </div>
                <div className="mt-1 text-xs text-[color:var(--color-muted)] uppercase tracking-wider">
                  {metric.label}
                </div>
              </div>
              {i < METRICS.length - 1 && (
                <div className="hidden md:block w-px h-12 bg-[var(--color-border)]" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
