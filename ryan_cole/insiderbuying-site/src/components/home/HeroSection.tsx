import Link from "next/link";

export function HeroSection() {
  return (
    <section className="relative bg-white overflow-hidden">
      <div className="mx-auto max-w-[1280px] px-6 py-24 md:py-32 flex flex-col md:flex-row items-center gap-12">
        {/* Text */}
        <div className="flex-1 max-w-xl">
          <h1 className="text-4xl md:text-5xl leading-tight text-[color:var(--color-text)]">
            Know What CEOs Are Buying,{" "}
            <span className="block">Before Everyone Else.</span>
          </h1>
          <p className="mt-6 text-lg text-[color:var(--color-muted)] leading-relaxed">
            Real-time SEC Form 4 alerts with AI-powered analysis. Track
            insider buying activity across 17,325+ publicly traded companies.
          </p>
          <div className="mt-8 flex items-center gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center h-12 px-8 text-sm font-semibold uppercase tracking-wider text-white bg-[var(--color-navy)] rounded-lg hover:bg-[var(--color-navy-light)] transition-colors"
            >
              Start Free
            </Link>
            <Link
              href="/alerts"
              className="inline-flex items-center justify-center h-12 px-8 text-sm font-semibold uppercase tracking-wider text-[color:var(--color-navy)] border border-[var(--color-navy)] rounded-lg hover:bg-[var(--color-bg-alt)] transition-colors"
            >
              See Live Alerts
            </Link>
          </div>
          <p className="mt-4 text-xs text-[color:var(--color-muted)]">
            Free plan available. No credit card required.
          </p>
        </div>

        {/* Hero image placeholder */}
        <div className="flex-1 relative w-full max-w-lg aspect-[4/3] rounded-xl overflow-hidden bg-gradient-to-br from-[var(--color-navy)] to-[#001a3a]">
          <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
            Hero Image
          </div>
        </div>
      </div>
    </section>
  );
}
