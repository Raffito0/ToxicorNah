export default function PrivacyPage() {
  return (
    <div className="bg-[var(--color-bg-alt)]">
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-hero-mobile)] pb-[var(--section-y-hero-mobile)] md:pt-[var(--section-y-hero)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto">
          <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[54px] font-normal leading-[1.1] text-[color:var(--color-text)] mb-[var(--gap-tight)]">Privacy Policy</h1>
          <p className="text-[14px] text-[color:var(--color-text-muted)]">Last updated: March 2026</p>
        </div>
      </section>

      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto flex flex-col gap-[var(--gap-cards)]">
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">1. Information We Collect</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">We collect information you provide directly, such as your name, email address, and payment information when you create an account or subscribe to our services. We also automatically collect usage data including IP address, browser type, and pages visited.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">2. How We Use Your Information</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">We use your information to provide and improve our services, send you alerts and notifications you&apos;ve opted into, process payments, and communicate with you about your account. We do not sell your personal data to third parties.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">3. Data Security</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">We implement industry-standard security measures including encryption in transit (TLS 1.3) and at rest (AES-256). Access to user data is restricted to authorized personnel only. We conduct regular security audits and penetration testing.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">4. Cookies & Tracking</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">We use essential cookies for authentication and session management. Analytics cookies help us understand how visitors use our site. You can disable non-essential cookies through your browser settings.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">5. Your Rights</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">You have the right to access, correct, or delete your personal data at any time. You may also request a copy of your data or opt out of marketing communications. To exercise these rights, contact us at privacy@earlyinsider.com.</p>
          </div>
          <div>
            <h2 className="text-[length:var(--text-heading)] font-bold leading-[32px] text-[color:var(--color-text)] mb-[12px]">6. Contact</h2>
            <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">For privacy-related inquiries, please contact our Data Protection Officer at <a href="mailto:privacy@earlyinsider.com" className="text-[color:var(--color-primary)] hover:underline">privacy@earlyinsider.com</a>.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
