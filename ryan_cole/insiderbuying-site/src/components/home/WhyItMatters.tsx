const METRICS = [
  {
    number: "6%",
    title: "Annual Outperformance",
    description: "Stocks with significant insider buying outperform the S&P 500 by an average of 6% per year.",
    source: "Harvard Business School",
  },
  {
    number: "73%",
    title: "Positive Returns",
    description: "When a CEO invests over $1M of their own money, the stock delivers positive returns within 12 months 73% of the time.",
    source: "Journal of Financial Economics",
  },
  {
    number: "2 Days",
    title: "Your Window",
    description: "Insiders must report to the SEC within 2 business days. We alert you within 60 seconds of the filing. That's your edge.",
    source: "SEC Rule 16a-3",
  },
];

export function WhyItMatters() {
  return (
    <section className="bg-[var(--color-bg-alt)] py-20">
      <div className="mx-auto max-w-[1100px] px-6">
        <h2 className="text-3xl text-center text-[color:var(--color-text)] mb-12">
          Why Insider Buying Matters
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {METRICS.map((metric) => (
            <div
              key={metric.number}
              className="bg-white rounded-lg border border-[var(--color-border)] p-8 text-center"
            >
              <div className="text-4xl font-bold font-[var(--font-mono)] text-[color:var(--color-accent-green)] mb-2">
                {metric.number}
              </div>
              <h3 className="text-lg text-[color:var(--color-text)] mb-3">
                {metric.title}
              </h3>
              <p className="text-sm text-[color:var(--color-muted)] leading-relaxed mb-4">
                {metric.description}
              </p>
              <p className="text-xs text-[color:var(--color-muted)] italic">
                {metric.source}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
