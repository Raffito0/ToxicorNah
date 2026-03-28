import Link from "next/link";

const FREE_FEATURES = [
  { text: "Delayed Alert Feed (15 min)", included: true },
  { text: "Weekly Insider Buying Digest", included: true },
  { text: "Top 5 Weekly Summary", included: true },
  { text: "Real-time alerts", included: false },
  { text: "AI analysis", included: false },
  { text: "Custom watchlist", included: false },
];

const PRO_FEATURES = [
  { text: "Real-time SEC Form 4 alerts", included: true },
  { text: "AI-powered trade analysis", included: true },
  { text: "Custom stock watchlist", included: true },
  { text: "Weekly Insider Buying Digest", included: true },
  { text: "Deep Dive Reports (20% off)", included: true },
  { text: "Priority email support", included: true },
];

export function Pricing() {
  return (
    <section id="pricing" className="bg-white py-20">
      <div className="mx-auto max-w-[900px] px-6">
        <h2 className="text-3xl text-center text-[color:var(--color-text)] mb-3">
          Simple Pricing
        </h2>
        <p className="text-center text-sm text-[color:var(--color-muted)] mb-12">
          Start free. Upgrade when you need real-time access.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Free */}
          <div className="bg-white rounded-lg border border-[var(--color-border)] p-8">
            <h3 className="text-lg text-[color:var(--color-text)] mb-2 font-[var(--font-inter)] font-semibold">
              Free
            </h3>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="text-4xl font-bold font-[var(--font-mono)] text-[color:var(--color-text)]">
                $0
              </span>
              <span className="text-sm text-[color:var(--color-muted)]">/month</span>
            </div>

            <ul className="space-y-3 mb-8">
              {FREE_FEATURES.map((f) => (
                <li key={f.text} className="flex items-start gap-2 text-sm">
                  {f.included ? (
                    <span className="text-[color:var(--color-accent-green)] mt-0.5">&#10003;</span>
                  ) : (
                    <span className="text-[color:var(--color-border)] mt-0.5">&#10005;</span>
                  )}
                  <span className={f.included ? "text-[color:var(--color-text)]" : "text-[color:var(--color-border)]"}>
                    {f.text}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              href="/signup"
              className="block w-full text-center h-10 leading-10 text-sm font-semibold uppercase tracking-wider border border-[var(--color-navy)] text-[color:var(--color-navy)] rounded-lg hover:bg-[var(--color-bg-alt)] transition-colors"
            >
              Get Started
            </Link>
          </div>

          {/* Pro */}
          <div className="relative bg-white rounded-lg border-2 border-[var(--color-navy)] p-8 shadow-md">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-block text-[11px] font-bold uppercase px-4 py-1 rounded-full bg-[var(--color-accent-green)] text-white">
              Most Popular
            </span>

            <h3 className="text-lg text-[color:var(--color-text)] mb-2 font-[var(--font-inter)] font-semibold">
              Pro
            </h3>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="text-4xl font-bold font-[var(--font-mono)] text-[color:var(--color-text)]">
                $29
              </span>
              <span className="text-sm text-[color:var(--color-muted)]">/month</span>
            </div>

            <ul className="space-y-3 mb-8">
              {PRO_FEATURES.map((f) => (
                <li key={f.text} className="flex items-start gap-2 text-sm text-[color:var(--color-text)]">
                  <span className="text-[color:var(--color-accent-green)] mt-0.5">&#10003;</span>
                  {f.text}
                </li>
              ))}
            </ul>

            <Link
              href="/signup"
              className="block w-full text-center h-10 leading-10 text-sm font-semibold uppercase tracking-wider bg-[var(--color-navy)] text-white rounded-lg hover:bg-[var(--color-navy-light)] transition-colors"
            >
              Start Pro
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
