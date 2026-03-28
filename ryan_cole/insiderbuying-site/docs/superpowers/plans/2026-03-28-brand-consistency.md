# Brand Consistency System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize all visual tokens (fonts, colors, spacing, radii) across 15 page files + 2 shared components into a unified design system, without changing any layouts.

**Architecture:** Expand `globals.css` `@theme` block with all design tokens. Then sweep each page file replacing hardcoded Tailwind values with token references. Navbar and Footer already partially use tokens (good) — they get normalized too.

**Tech Stack:** Next.js 14, Tailwind CSS v4 (`@theme` block), TypeScript/TSX

---

## File Map

| File | Action | Lines |
|------|--------|-------|
| `src/app/globals.css` | Modify: expand `@theme` with full token set + base heading styles | 47 |
| `src/components/Navbar.tsx` | Modify: normalize CTA button style | 120 |
| `src/components/Footer.tsx` | Modify: replace hardcoded colors/sizes with tokens | 58 |
| `src/app/privacy/page.tsx` | Modify: replace hardcoded values | 41 |
| `src/app/terms/page.tsx` | Modify: replace hardcoded values | 49 |
| `src/app/contact/page.tsx` | Modify: replace hardcoded values | 45 |
| `src/app/faq/page.tsx` | Modify: replace hardcoded values | 188 |
| `src/app/blog/page.tsx` | Modify: replace hardcoded values | 258 |
| `src/app/reports/page.tsx` | Modify: replace hardcoded values | 160 |
| `src/app/free-report/page.tsx` | Modify: replace hardcoded values | 253 |
| `src/app/about/page.tsx` | Modify: replace hardcoded values | 144 |
| `src/app/methodology/page.tsx` | Modify: replace hardcoded values | 158 |
| `src/app/how-it-works/page.tsx` | Modify: replace hardcoded values | 585 |
| `src/app/alerts/page.tsx` | Modify: replace hardcoded values | 306 |
| `src/app/pricing/page.tsx` | Modify: replace hardcoded values | 288 |
| `src/app/page.tsx` | Modify: replace hardcoded values (homepage) | 371 |
| `tmp_brand_audit/audit.mjs` | Modify: re-run for verification | existing |

---

## Token Reference (from spec)

**Typography tokens** — used as CSS custom properties in `@theme`:
- `--text-display: 54px` (h1), `--text-title: 42px` (h2), `--text-heading: 24px` (h3), `--text-subheading: 18px` (h4)
- `--text-body: 16px`, `--text-small: 14px`, `--text-caption: 12px`

**Color tokens** — already partially defined, need consolidation:
- Text: `--color-text: #1C1B1B`, `--color-text-secondary: #454556`, `--color-text-muted: #94A3B8`
- Backgrounds: `--color-bg-white: #FFFFFF`, `--color-bg-alt: #F6F3F2`, `--color-bg-dark: #151414`
- Brand: `--color-primary: #000592`, `--color-primary-dark: #000250`, `--color-navy: #002A5E`
- Signals: `--color-signal-green: #006D34`, `--color-signal-green-bg: #C4E6D0`, `--color-signal-red: #930A0A`, `--color-signal-red-bg: #FFDAD6`
- Borders: `--color-border: #E5E2E1`, `--color-border-light: #F0EDED`

**Spacing tokens**:
- `--section-y: 96px`, `--section-y-hero: 128px`
- `--section-y-mobile: 64px`, `--section-y-hero-mobile: 80px`
- `--gap-section: 64px`, `--gap-cards: 32px`, `--gap-items: 24px`, `--gap-tight: 16px`

**Replacement mappings** (what to search → replace):

| Hardcoded | Replacement |
|-----------|-------------|
| `text-[#1c1b1b]` | `text-[var(--color-text)]` |
| `text-[#1a1a1a]` | `text-[var(--color-text)]` |
| `text-[#00011d]` | `text-[var(--color-text)]` |
| `text-[#454556]` | `text-[var(--color-text-secondary)]` |
| `text-[#5c6670]` | `text-[var(--color-text-secondary)]` |
| `text-[#757688]` | `text-[var(--color-text-muted)]` |
| `text-[#757788]` | `text-[var(--color-text-muted)]` |
| `text-[#94a3b8]` | `text-[var(--color-text-muted)]` |
| `text-[#64748b]` | `text-[var(--color-text-muted)]` |
| `text-[#9faab6]` | `text-[var(--color-text-muted)]` |
| `bg-[#f6f3f2]` | `bg-[var(--color-bg-alt)]` |
| `bg-[#fcf9f8]` | `bg-[var(--color-bg-alt)]` |
| `bg-[#f5f6f8]` | `bg-[var(--color-bg-alt)]` |
| `bg-[#f0f1f3]` | `bg-[var(--color-bg-alt)]` |
| `bg-[#f3f4f6]` | `bg-[var(--color-bg-alt)]` |
| `bg-[#245, 246, 248]` | `bg-[var(--color-bg-alt)]` |
| `bg-[#151414]` | `bg-[var(--color-bg-dark)]` |
| `bg-[#141313]` | `bg-[var(--color-bg-dark)]` |
| `bg-[#000592]` | `bg-[var(--color-primary)]` |
| `bg-[#000232]` | `bg-[var(--color-primary-dark)]` |
| `bg-[#000250]` | `bg-[var(--color-primary-dark)]` |
| `bg-[#002a5e]` | `bg-[var(--color-navy)]` |
| `text-[#000592]` | `text-[var(--color-primary)]` |
| `text-[#080f99]` | `text-[var(--color-primary)]` |
| `text-[#000ad2]` | `text-[var(--color-primary)]` |
| `hover:bg-[#080f99]` | `hover:bg-[var(--color-primary-dark)]` |
| `text-[#006d34]` | `text-[var(--color-signal-green)]` |
| `text-[#005c09]` | `text-[var(--color-signal-green)]` |
| `text-[#02810e]` | `text-[var(--color-signal-green)]` |
| `bg-[#006d34]` | `bg-[var(--color-signal-green)]` |
| `border-[#f0eded]` | `border-[var(--color-border-light)]` |
| `border-[#e5e2e1]` | `border-[var(--color-border)]` |
| `border-[#c6c5d9]` | `border-[var(--color-border)]` |
| `border-[#d1d6da]` | `border-[var(--color-border)]` |
| `border-[#e9e7e7]` | `border-[var(--color-border)]` |
| `rounded-[4px]` | remove (0px default) |
| `rounded-[8px]` | remove (0px default) |
| `rounded-[16px]` | remove (0px default) |
| `rounded-[2px]` | remove (0px default) |

**Heading standardization** — what to change per tag:

| Tag | Current chaos | Target |
|-----|---------------|--------|
| h1 | 42px, 48px, 54px, 60px / weight 400 or 700 | Always `text-[54px] font-normal leading-[1.15]` |
| h2 section | 20px-48px / weight 400 or 700 | Always `text-[42px] font-normal leading-[1.2]` |
| h2 sub-section (contact, privacy, terms) | 20px-24px / bold | Keep `text-[24px] font-bold` — these are content h2s in legal pages, not section titles |
| h3 | 18-26px / various weights | Always `text-[24px] font-bold leading-[1.3]` |
| h4 | 18-32px / various | Always `text-[18px] font-bold leading-[1.4]` |

**Exception**: Legal pages (privacy, terms) use h2 at 24px/bold intentionally — these are content headings within a single section, not section-level titles. Leave them as-is.

---

### Task 1: Expand globals.css with full design token system

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace globals.css with expanded token system**

```css
@import "tailwindcss";

@theme {
  /* ── Brand ── */
  --color-primary: #000592;
  --color-primary-dark: #000250;
  --color-navy: #002A5E;

  /* ── Text ── */
  --color-text: #1C1B1B;
  --color-text-secondary: #454556;
  --color-text-muted: #94A3B8;

  /* ── Backgrounds ── */
  --color-bg-white: #FFFFFF;
  --color-bg-alt: #F6F3F2;
  --color-bg-dark: #151414;

  /* ── Signals ── */
  --color-signal-green: #006D34;
  --color-signal-green-bg: #C4E6D0;
  --color-signal-red: #930A0A;
  --color-signal-red-bg: #FFDAD6;

  /* ── Borders ── */
  --color-border: #E5E2E1;
  --color-border-light: #F0EDED;

  /* ── Link ── */
  --color-link: #000AD2;

  /* ── Fonts ── */
  --font-montaga: "Montaga", serif;
  --font-inter: "Inter", sans-serif;
  --font-mono: "Space Mono", monospace;

  /* ── Typography Scale ── */
  --text-display: 54px;
  --text-title: 42px;
  --text-heading: 24px;
  --text-subheading: 18px;
  --text-body: 16px;
  --text-small: 14px;
  --text-caption: 12px;

  /* ── Spacing ── */
  --section-y: 96px;
  --section-y-hero: 128px;
  --section-y-mobile: 64px;
  --section-y-hero-mobile: 80px;
  --gap-section: 64px;
  --gap-cards: 32px;
  --gap-items: 24px;
  --gap-tight: 16px;
}

body {
  font-family: var(--font-inter);
  color: var(--color-text);
  background-color: var(--color-bg-white);
}

h1, h2, h3, h4 {
  font-family: var(--font-montaga);
}
```

- [ ] **Step 2: Verify the dev server still works**

Run: `cd ryan_cole/insiderbuying-site && npm run dev`
Expected: No build errors, site loads normally at localhost:3000.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: expand globals.css with full design token system"
```

---

### Task 2: Normalize Navbar and Footer

**Files:**
- Modify: `src/components/Navbar.tsx`
- Modify: `src/components/Footer.tsx`

- [ ] **Step 1: Update Navbar.tsx**

The Navbar already uses CSS variables well. Only change needed: the "Start Free" CTA uses `rounded-lg` — change to no rounding for consistency. And `bg-[var(--color-navy)]` should become `bg-[var(--color-primary)]` for brand consistency (primary blue, not navy).

In `src/components/Navbar.tsx`, replace:
```tsx
className="inline-flex items-center justify-center h-10 px-6 text-sm font-semibold uppercase tracking-wider text-white bg-[var(--color-navy)] rounded-lg hover:bg-[var(--color-navy-light)] transition-colors"
```
with:
```tsx
className="inline-flex items-center justify-center h-10 px-6 text-sm font-semibold uppercase tracking-wider text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] transition-colors"
```

Also replace the mobile CTA (line 111):
```tsx
className="block w-full text-center h-10 leading-10 text-sm font-semibold uppercase tracking-wider text-white bg-[var(--color-navy)] rounded-lg"
```
with:
```tsx
className="block w-full text-center h-10 leading-10 text-sm font-semibold uppercase tracking-wider text-white bg-[var(--color-primary)]"
```

- [ ] **Step 2: Update Footer.tsx**

Replace the entire Footer component with token-based version:

```tsx
import Link from "next/link";

export function Footer() {
  return (
    <footer className="w-full bg-[var(--color-bg-dark)] pt-[60px] px-[20px] pb-[40px] md:pt-[80px] md:px-[60px]">
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[var(--gap-cards)] mb-[40px] md:mb-[80px]">
          <div>
            <p className="font-[var(--font-montaga)] text-[22px] leading-[28px] text-white mb-[22px]">Early Insider</p>
            <p className="text-[var(--text-small)] leading-[23px] text-[var(--color-text-muted)]">Precise signals. Real-time edge.</p>
          </div>
          <div>
            <p className="text-[var(--text-body)] leading-[24px] text-white mb-[var(--gap-items)]">Product</p>
            <ul className="space-y-[var(--gap-tight)]">
              {[
                { label: "About", href: "/about" },
                { label: "Pricing", href: "/pricing" },
                { label: "FAQ", href: "/faq" },
                { label: "Blog", href: "/blog" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-[var(--text-small)] leading-[20px] text-[var(--color-text-muted)] hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[var(--text-body)] leading-[24px] text-white mb-[var(--gap-items)]">Company</p>
            <ul className="space-y-[var(--gap-tight)]">
              {[
                { label: "Contact", href: "/contact" },
                { label: "Privacy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-[var(--text-small)] leading-[20px] text-[var(--color-text-muted)] hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[var(--text-body)] leading-[24px] text-white mb-[var(--gap-items)]">Legal</p>
            <p className="text-[10px] leading-[16px] tracking-[0.5px] text-[var(--color-text-muted)]">
              Legal Disclaimer: Financial data is for informational purposes only. Trading involves significant risk. Consult a professional advisor before making any investment decisions.
            </p>
          </div>
        </div>
        <div className="border-t border-white/10 pt-[var(--gap-tight)]">
          <p className="text-[var(--text-caption)] leading-[16px] text-[var(--color-text-muted)]">&copy; 2026 EarlyInsider. Institutional Grade Data. All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Verify navbar and footer render correctly**

Run: `npm run dev`, check homepage. Navbar CTA should be primary blue (not navy). Footer should look identical.

- [ ] **Step 4: Commit**

```bash
git add src/components/Navbar.tsx src/components/Footer.tsx
git commit -m "feat: normalize Navbar + Footer to design tokens"
```

---

### Task 3: Normalize legal pages (privacy, terms, contact)

**Files:**
- Modify: `src/app/privacy/page.tsx`
- Modify: `src/app/terms/page.tsx`
- Modify: `src/app/contact/page.tsx`

- [ ] **Step 1: Update privacy/page.tsx**

Replace all hardcoded values. The pattern for these legal pages:
- Hero section: `bg-[var(--color-bg-alt)]`, `py-[var(--section-y-hero-mobile)] md:py-[var(--section-y-hero)]`
- Content section: `bg-white`, `py-[var(--section-y-mobile)] md:py-[var(--section-y)]`
- H1: `text-[39px] md:text-[var(--text-display)]`
- H2 (legal content): keep at `text-[var(--text-heading)] font-bold` (these are content headings, not section titles)
- Body text: `text-[var(--color-text-secondary)]`
- Metadata text: `text-[var(--color-text-muted)]`

Full replacement for `src/app/privacy/page.tsx`:

```tsx
export default function PrivacyPage() {
  return (
    <div className="bg-[var(--color-bg-alt)]">
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-hero-mobile)] pb-[var(--section-y-hero-mobile)] md:pt-[var(--section-y-hero)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto">
          <h1 className="text-[39px] md:text-[var(--text-display)] font-normal leading-[1.15] text-[var(--color-text)] mb-[var(--gap-tight)]">Privacy Policy</h1>
          <p className="text-[var(--text-small)] text-[var(--color-text-muted)]">Last updated: March 2026</p>
        </div>
      </section>

      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto flex flex-col gap-[var(--gap-cards)]">
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">1. Information We Collect</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">We collect information you provide directly, such as your name, email address, and payment information when you create an account or subscribe to our services. We also automatically collect usage data including IP address, browser type, and pages visited.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">2. How We Use Your Information</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">We use your information to provide and improve our services, send you alerts and notifications you&apos;ve opted into, process payments, and communicate with you about your account. We do not sell your personal data to third parties.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">3. Data Security</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">We implement industry-standard security measures including encryption in transit (TLS 1.3) and at rest (AES-256). Access to user data is restricted to authorized personnel only. We conduct regular security audits and penetration testing.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">4. Cookies & Tracking</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">We use essential cookies for authentication and session management. Analytics cookies help us understand how visitors use our site. You can disable non-essential cookies through your browser settings.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">5. Your Rights</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">You have the right to access, correct, or delete your personal data at any time. You may also request a copy of your data or opt out of marketing communications. To exercise these rights, contact us at privacy@earlyinsider.com.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">6. Contact</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">For privacy-related inquiries, please contact our Data Protection Officer at <a href="mailto:privacy@earlyinsider.com" className="text-[var(--color-primary)] hover:underline">privacy@earlyinsider.com</a>.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Update terms/page.tsx**

Same pattern as privacy. Full replacement for `src/app/terms/page.tsx`:

```tsx
export default function TermsPage() {
  return (
    <div className="bg-[var(--color-bg-alt)]">
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-hero-mobile)] pb-[var(--section-y-hero-mobile)] md:pt-[var(--section-y-hero)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto">
          <h1 className="text-[39px] md:text-[var(--text-display)] font-normal leading-[1.15] text-[var(--color-text)] mb-[var(--gap-tight)]">Terms of Service</h1>
          <p className="text-[var(--text-small)] text-[var(--color-text-muted)]">Last updated: March 2026</p>
        </div>
      </section>

      <section className="bg-white pt-[var(--section-y-mobile)] pb-[var(--section-y-mobile)] md:pt-[var(--section-y)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto flex flex-col gap-[var(--gap-cards)]">
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">1. Acceptance of Terms</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">By accessing or using EarlyInsider, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use our services.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">2. Service Description</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">EarlyInsider provides financial data analytics, SEC Form 4 filing alerts, and AI-powered analysis of insider trading activity. Our platform aggregates publicly available data from the SEC EDGAR database and applies proprietary scoring models.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">3. Not Financial Advice</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">EarlyInsider is not a registered investment advisor, broker-dealer, or financial planner. All information provided through our platform is for educational and informational purposes only. Nothing on this site constitutes financial, legal, or tax advice. Past performance of insider trading signals does not guarantee future results. Always consult a qualified financial advisor before making investment decisions.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">4. Account Terms</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">You must provide accurate and complete information when creating an account. You are responsible for maintaining the security of your account credentials. You must be at least 18 years old to use our services.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">5. Subscription & Billing</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">Paid subscriptions are billed monthly or annually as selected. You may cancel at any time from your account settings. Cancellation takes effect at the end of the current billing period. No refunds are provided for partial billing periods.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">6. Intellectual Property</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">All content, analysis, scoring models, and proprietary data on EarlyInsider are owned by us. You may not reproduce, distribute, or create derivative works from our content without written permission.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">7. Limitation of Liability</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">EarlyInsider shall not be liable for any indirect, incidental, or consequential damages arising from your use of our services. Our total liability shall not exceed the amount paid by you in the 12 months preceding the claim.</p>
          </div>
          <div>
            <h2 className="text-[var(--text-heading)] font-bold leading-[1.3] text-[var(--color-text)] mb-[12px]">8. Contact</h2>
            <p className="text-[var(--text-body)] leading-[26px] text-[var(--color-text-secondary)]">For questions about these terms, contact us at <a href="mailto:legal@earlyinsider.com" className="text-[var(--color-primary)] hover:underline">legal@earlyinsider.com</a>.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Update contact/page.tsx**

Same token pattern. In `src/app/contact/page.tsx`, apply the same replacements:
- `bg-[#fcf9f8]` → `bg-[var(--color-bg-alt)]`
- `bg-[#f6f3f2]` → `bg-[var(--color-bg-alt)]`
- `text-[#1c1b1b]` → `text-[var(--color-text)]`
- `text-[#454556]` → `text-[var(--color-text-secondary)]`
- `text-[#000592]` → `text-[var(--color-primary)]`
- Section padding → token values
- H1 → `text-[39px] md:text-[var(--text-display)]`
- H2 (20px) → `text-[var(--text-subheading)]` (these are small functional headings)

- [ ] **Step 4: Verify all 3 pages**

Run: `npm run dev`, visit `/privacy`, `/terms`, `/contact`. Should look identical to before.

- [ ] **Step 5: Commit**

```bash
git add src/app/privacy/page.tsx src/app/terms/page.tsx src/app/contact/page.tsx
git commit -m "feat: normalize privacy, terms, contact pages to design tokens"
```

---

### Task 4: Normalize FAQ page

**Files:**
- Modify: `src/app/faq/page.tsx`

- [ ] **Step 1: Apply token replacements throughout faq/page.tsx**

Key changes:
- All `bg-[#fcf9f8]` → `bg-[var(--color-bg-alt)]`
- All `bg-[#f6f3f2]` → `bg-[var(--color-bg-alt)]`
- All `text-[#1c1b1b]` → `text-[var(--color-text)]`
- All `text-[#454556]` → `text-[var(--color-text-secondary)]`
- All `text-[#000592]` → `text-[var(--color-primary)]`
- All `border-[#000592]` → `border-[var(--color-primary)]`
- All `border-[#c6c5d9]` → `border-[var(--color-border)]`
- Section padding: normalize to `py-[var(--section-y-mobile)] md:py-[var(--section-y)]` (was 48-112px)
- Hero padding: `py-[var(--section-y-hero-mobile)] md:py-[var(--section-y-hero)]` (was 64-112px)
- H1: `text-[39px] md:text-[var(--text-display)]`
- H2 section titles (30px): → `text-[var(--text-heading)]` (these are FAQ group titles, not full section H2s)
- H2 "Still have questions?" (48px): → `text-[var(--text-title)]`
- H3 bento card (40px): → `text-[var(--text-title)]` (it's a promotional heading)
- H4 "Institutional Security" (32px): → `text-[var(--text-heading)]`
- Remove `lg:px-[192px]`, `lg:px-[250px]`, `lg:px-[88px]` — use `max-w-[1200px] mx-auto px-6 md:px-10` container instead
- Remove `rounded-[4px]` from bento cards
- FAQ accordion items keep their internal padding (functional, not brand)

- [ ] **Step 2: Verify FAQ page**

Run: `npm run dev`, visit `/faq`. Accordion should work, all sections should look consistent.

- [ ] **Step 3: Commit**

```bash
git add src/app/faq/page.tsx
git commit -m "feat: normalize FAQ page to design tokens"
```

---

### Task 5: Normalize blog and reports pages

**Files:**
- Modify: `src/app/blog/page.tsx`
- Modify: `src/app/reports/page.tsx`

- [ ] **Step 1: Apply token replacements to blog/page.tsx**

Same replacement mapping. Key blog-specific changes:
- Blog hero `bg-[#f5f6f8]` → `bg-[var(--color-bg-alt)]`
- Subscribe section `bg-[#002a5e]` → `bg-[var(--color-navy)]`
- H1 "Blog" (54px) → `text-[var(--text-display)]`
- H2 article titles (30px) → keep at `text-[30px]` (intentionally smaller for article cards — they're not section titles)
- H3 article cards (22px) → `text-[22px]` (keep — card titles within a grid)
- H2 "Subscribe to the Briefing" (42px) → `text-[var(--text-title)]`
- All color replacements per mapping

- [ ] **Step 2: Apply token replacements to reports/page.tsx**

- H1 "Deep Dive Reports" (54px) → `text-[var(--text-display)]`
- H2 "Magnificent 7 Report" (32px) → keep (product title, not section)
- H3 report cards (24px) → `text-[var(--text-heading)]`
- H2 "Need a Custom Report?" (40px) → `text-[var(--text-title)]`
- All color/background replacements per mapping

- [ ] **Step 3: Verify both pages**

Run: `npm run dev`, visit `/blog` and `/reports`.

- [ ] **Step 4: Commit**

```bash
git add src/app/blog/page.tsx src/app/reports/page.tsx
git commit -m "feat: normalize blog + reports pages to design tokens"
```

---

### Task 6: Normalize about and free-report pages

**Files:**
- Modify: `src/app/about/page.tsx`
- Modify: `src/app/free-report/page.tsx`

- [ ] **Step 1: Apply token replacements to about/page.tsx**

Key changes:
- Hero `bg-[#000592]` → `bg-[var(--color-primary)]`
- Page wrapper `bg-[#fcf9f8]` → `bg-[var(--color-bg-alt)]`
- H1 → `text-[39px] md:text-[var(--text-display)]`
- All H2 section titles (48px) → `text-[32px] md:text-[var(--text-title)]`
- H2 smaller (36-40px) → `text-[30px] md:text-[var(--text-title)]`
- H3 step cards (18px bold) → `text-[var(--text-subheading)] font-bold`
- `text-[#5c6670]` → `text-[var(--color-text-secondary)]`
- CTA button `bg-[#000592]` → `bg-[var(--color-primary)]`, remove `rounded-[4px]`
- `hover:bg-[#080f99]` → `hover:bg-[var(--color-primary-dark)]`
- Section padding → token values
- Remove `lg:px-[240px]`, `lg:px-[192px]` — use container pattern

- [ ] **Step 2: Apply token replacements to free-report/page.tsx**

Same mapping. Key specifics:
- H1 → `text-[var(--text-display)]`
- H2 "Get the Report" / "What You'll Learn" (42px) → `text-[var(--text-title)]`
- H3 feature cards (20px bold) → `text-[20px] font-bold` (keep — feature card titles)
- CTA section `bg-[#002a5e]` → `bg-[var(--color-navy)]`
- H2 CTA "Don't invest blind" (42px) → `text-[var(--text-title)]`
- Remove `lg:px-[390px]`, `lg:px-[150px]` — use container

- [ ] **Step 3: Verify both pages**

Run: `npm run dev`, visit `/about` and `/free-report`.

- [ ] **Step 4: Commit**

```bash
git add src/app/about/page.tsx src/app/free-report/page.tsx
git commit -m "feat: normalize about + free-report pages to design tokens"
```

---

### Task 7: Normalize methodology and how-it-works pages

**Files:**
- Modify: `src/app/methodology/page.tsx`
- Modify: `src/app/how-it-works/page.tsx`

- [ ] **Step 1: Apply token replacements to methodology/page.tsx**

Key changes:
- H1 "How We Analyze" (60px) → `text-[39px] md:text-[var(--text-display)]` (was 60, now 54)
- H2 section titles (48px, 30px) → `text-[32px] md:text-[var(--text-title)]`
- H3 data source cards (18px bold) → `text-[var(--text-subheading)] font-bold`
- H3 process steps (24px bold) → `text-[var(--text-heading)] font-bold`
- All color replacements
- Section padding → tokens
- Remove `lg:px-[90px]`, `lg:px-[128px]`, `lg:px-[190px]`, `lg:px-[222px]` — use container

- [ ] **Step 2: Apply token replacements to how-it-works/page.tsx**

This is the largest file (585 lines). Key changes:
- H1 "How It Works" (42px, weight 700) → `text-[39px] md:text-[var(--text-display)] font-normal` (was 42/700, now 54/400)
- H2 section titles (28-36px, mixed weights) → `text-[32px] md:text-[var(--text-title)] font-normal`
- H3 pipeline steps (20px bold) → `text-[20px] font-bold`
- H4 tech stack cards (18px bold) → `text-[var(--text-subheading)] font-bold`
- CTA section `bg-[#000592]` → `bg-[var(--color-primary)]`
- H2 CTA (32px, bold) → `text-[var(--text-title)] font-normal`
- All color/bg/border replacements
- Section padding → tokens
- Remove all `lg:px-[72px]` etc → use container
- `bg-[#f5f6f8]` → `bg-[var(--color-bg-alt)]`

- [ ] **Step 3: Verify both pages**

Run: `npm run dev`, visit `/methodology` and `/how-it-works`.

- [ ] **Step 4: Commit**

```bash
git add src/app/methodology/page.tsx src/app/how-it-works/page.tsx
git commit -m "feat: normalize methodology + how-it-works pages to design tokens"
```

---

### Task 8: Normalize alerts and pricing pages

**Files:**
- Modify: `src/app/alerts/page.tsx`
- Modify: `src/app/pricing/page.tsx`

- [ ] **Step 1: Apply token replacements to alerts/page.tsx**

Key changes:
- H1 "Live Insider Activity" (42px) → `text-[32px] md:text-[var(--text-title)]`
- All `text-[#1c1b1b]`, `text-[#454556]`, `text-[#757688]` → tokens
- `bg-[#f6f3f2]` → `bg-[var(--color-bg-alt)]`
- `bg-[#000592]` → `bg-[var(--color-primary)]`
- `text-[#006d34]` → `text-[var(--color-signal-green)]`
- `border-[#c6c5d9]` → `border-[var(--color-border)]`
- `blur-[4px]` stays (functional, not brand)
- Alert card internal padding stays (functional)

- [ ] **Step 2: Apply token replacements to pricing/page.tsx**

Key changes:
- H1 "Simple Pricing" → `text-[var(--text-display)]`
- H2 "Compare features" / "FAQs" (42px) → `text-[var(--text-title)]`
- H2 CTA (42px) → `text-[var(--text-title)]`
- `bg-[#f6f3f2]` → `bg-[var(--color-bg-alt)]`
- `bg-[#000592]` → `bg-[var(--color-primary)]`
- `border-[#080f99]` → `border-[var(--color-primary)]`
- `border-[#757688]` → `border-[var(--color-border)]`
- `text-[#757688]` → `text-[var(--color-text-muted)]`
- Remove `rounded-[4px]` from CTA buttons
- Section padding → tokens

- [ ] **Step 3: Verify both pages**

Run: `npm run dev`, visit `/alerts` and `/pricing`.

- [ ] **Step 4: Commit**

```bash
git add src/app/alerts/page.tsx src/app/pricing/page.tsx
git commit -m "feat: normalize alerts + pricing pages to design tokens"
```

---

### Task 9: Normalize homepage (page.tsx)

**Files:**
- Modify: `src/app/page.tsx`

This is the most complex page with 10+ sections.

- [ ] **Step 1: Apply token replacements throughout page.tsx**

Section-by-section changes:

**Hero (section 1):** Keep gradient background (unique to hero). Replace:
- `text-[54px]` reference in H1 stays (already correct)
- `tracking-[0.5px]` → remove (normal)
- `tracking-[0.2px]` → remove (normal)

**Logo ticker (section 1.5):** Replace:
- `text-[#1c1b1b]/60` → `text-[var(--color-text)]/60`

**Live Alert Feed (section 2):** Replace:
- `text-[#00011d]` → `text-[var(--color-text)]`
- `bg-[#f6f3f2]`, `bg-[#f0f1f3]` → `bg-[var(--color-bg-alt)]`
- `border-[#e5e2e1]` → `border-[var(--color-border)]`
- `text-[#757688]` → `text-[var(--color-text-muted)]`
- `text-[#005c09]` → `text-[var(--color-signal-green)]`
- `text-[#006d34]` → `text-[var(--color-signal-green)]`
- `text-[#454556]` → `text-[var(--color-text-secondary)]`
- `rounded-[8px]` → remove
- Section padding → tokens

**How It Works (section 3):**
- H2 (48px) → `text-[39px] md:text-[var(--text-title)]`
- H3 (22px) → `text-[22px]` (keep — they're step titles in a 3-col grid, slightly smaller than heading token)
- All color replacements

**Why Insider Buying Matters (section 4):**
- `bg-[#f6f3f2]` → `bg-[var(--color-bg-alt)]`
- H2 (48px) → `text-[39px] md:text-[var(--text-title)]`
- All color replacements

**Detailed Alert Card (section 5):**
- `bg-[#f6f3f2]` → `bg-[var(--color-bg-alt)]`
- `bg-[#f0f1f3]` → `bg-[var(--color-bg-alt)]`
- `text-[#006d34]` → `text-[var(--color-signal-green)]`
- `bg-[#006d34]` → `bg-[var(--color-signal-green)]`
- `bg-[#e5e2e1]` → `bg-[var(--color-border)]`
- `border-[#f0eded]` → `border-[var(--color-border-light)]`
- `border-[#c6c5d9]` → `border-[var(--color-border)]`
- `rounded-[16px]` → remove
- `rounded-[2px]` → remove

**Charts (section 6):**
- `bg-[#f6f3f2]` → `bg-[var(--color-bg-alt)]`
- H2 (48px) → `text-[39px] md:text-[var(--text-title)]`
- All color replacements

**Deep Dive Reports (section 6.5):**
- `bg-[#000232]` → `bg-[var(--color-primary-dark)]`
- `text-[#9faab6]` → `text-[var(--color-text-muted)]`
- `text-[#1a1a1a]` → `text-[var(--color-text)]`
- `text-[#080f99]` → `text-[var(--color-primary)]`
- `bg-[#000592]` → `bg-[var(--color-primary)]`
- `ring-[#000592]` → `ring-[var(--color-primary)]`

**Pricing (section 8):**
- `bg-[#f6f3f2]` → `bg-[var(--color-bg-alt)]`
- `bg-[#000592]` → `bg-[var(--color-primary)]`
- `border-[#080f99]` → `border-[var(--color-primary)]`
- `border-[#757688]` → `border-[var(--color-border)]`
- `text-[#757688]` → `text-[var(--color-text-muted)]`

**FAQ (section 9):**
- `border-[#f0eded]` → `border-[var(--color-border-light)]`
- `text-[#757688]` → `text-[var(--color-text-muted)]`

**Final CTA (section 10):**
- `bg-[#141313]` → `bg-[var(--color-bg-dark)]`
- `text-[#94a3b8]` → `text-[var(--color-text-muted)]`
- `bg-[#000592]` → `bg-[var(--color-primary)]`
- `hover:bg-[#080f99]` → `hover:bg-[var(--color-primary-dark)]`
- `rounded-[4px]` → remove

- [ ] **Step 2: Remove all `tracking-[...]` values**

The homepage has many `tracking-[0.2px]`, `tracking-[0.5px]`, `tracking-[0.1px]`, `tracking-[1px]` values. Per spec, only `tracking-normal` (omit) and `tracking-[0.5px]` for captions. Remove all non-caption tracking values.

- [ ] **Step 3: Verify homepage**

Run: `npm run dev`, visit `/`. Check all 10 sections render correctly.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: normalize homepage to design tokens"
```

---

### Task 10: Re-run Playwright audit to verify

**Files:**
- Run: `tmp_brand_audit/audit.mjs`

- [ ] **Step 1: Run Playwright audit**

```bash
cd ryan_cole/insiderbuying-site && node tmp_brand_audit/audit.mjs
```

- [ ] **Step 2: Check audit_summary.md against success criteria**

Expected results:
- Font sizes: max 7-10 unique (down from 23). Some pages may have intentional one-offs (blog card titles, pricing numbers)
- Text colors: max 5-6 unique (down from 26)
- Background colors: max 5-6 unique (down from 34)
- Border radius: max 2 unique — `0px` and `9999px` (down from 8)
- Letter spacing: max 2 unique — `normal` and `0.5px` (down from 12)
- Border colors: max 3 unique (down from 16)

- [ ] **Step 3: Fix any remaining hardcoded values found in audit**

If the audit shows values not covered by previous tasks, fix them.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: remaining hardcoded values caught by audit"
```

---

## Login and Signup pages

`src/app/login/page.tsx` (184 lines) and `src/app/signup/page.tsx` (244 lines) were not screenshotted by Playwright (they likely redirect or are behind auth). They should get the same token treatment but were excluded from the audit. Apply the same replacement mapping if needed after the main sweep.

## blog/[slug]/page.tsx

Dynamic blog post page — apply same token mapping for any hardcoded colors/sizes in the template.
