import Link from "next/link";

export function Footer() {
  return (
    <footer className="w-full bg-[var(--color-bg-dark)] pt-[60px] px-[20px] pb-[40px] md:pt-[80px] md:px-[60px]">
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[var(--gap-cards)] mb-[40px] md:mb-[80px]">
          <div>
            <p className="font-[var(--font-montaga)] text-[22px] leading-[28px] text-white mb-[22px]">Early Insider</p>
            <p className="text-[length:var(--text-small)] leading-[23px] text-[color:var(--color-text-muted)]">Precise signals. Real-time edge.</p>
          </div>
          <div>
            <p className="text-[length:var(--text-body)] leading-[24px] text-white mb-[var(--gap-items)]">Product</p>
            <ul className="space-y-[var(--gap-tight)]">
              {[
                { label: "About", href: "/about" },
                { label: "Pricing", href: "/pricing" },
                { label: "FAQ", href: "/faq" },
                { label: "Blog", href: "/blog" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-[length:var(--text-small)] leading-[20px] text-[color:var(--color-text-muted)] hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[length:var(--text-body)] leading-[24px] text-white mb-[var(--gap-items)]">Company</p>
            <ul className="space-y-[var(--gap-tight)]">
              {[
                { label: "Contact", href: "/contact" },
                { label: "Privacy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-[length:var(--text-small)] leading-[20px] text-[color:var(--color-text-muted)] hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[length:var(--text-body)] leading-[24px] text-white mb-[var(--gap-items)]">Legal</p>
            <p className="text-[12px] leading-[16px] tracking-[0.5px] text-[color:var(--color-text-muted)]">
              EarlyInsider provides financial data and analysis for informational purposes only. Past insider trading patterns do not guarantee future results.
            </p>
          </div>
        </div>
        <div className="border-t border-white/10 pt-[var(--gap-tight)]">
          <p className="text-[length:var(--text-caption)] leading-[16px] text-[color:var(--color-text-muted)]">&copy; 2026 EarlyInsider. All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}
