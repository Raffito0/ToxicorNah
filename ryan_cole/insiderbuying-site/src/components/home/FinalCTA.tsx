import Link from "next/link";

export function FinalCTA() {
  return (
    <section className="bg-[var(--color-navy)] py-20">
      <div className="mx-auto max-w-[700px] px-6 text-center">
        <h2 className="text-3xl md:text-4xl text-white mb-4">
          You&apos;ll know in 60 seconds.
        </h2>
        <p className="text-base text-white/70 mb-8 leading-relaxed">
          Don&apos;t wait for the morning news. Get institutional-grade
          insider data delivered in real-time.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center justify-center h-12 px-10 text-sm font-semibold uppercase tracking-wider text-white bg-[var(--color-accent-green)] rounded-lg hover:bg-[#00b85c] transition-colors"
        >
          Start Free
        </Link>
      </div>
    </section>
  );
}
