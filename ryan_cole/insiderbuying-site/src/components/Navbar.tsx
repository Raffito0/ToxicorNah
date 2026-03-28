"use client";

import Link from "next/link";
import { useState } from "react";

const NAV_LINKS = [
  { href: "/alerts", label: "Live Alerts" },
  { href: "/reports", label: "Reports" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[var(--color-border-light)]">
      <nav aria-label="Main menu" className="mx-auto max-w-[1280px] flex items-center justify-between h-20 px-6">
        {/* Logo */}
        <Link href="/" className="flex items-baseline gap-0 text-xl">
          <span className="font-[var(--font-inter)] font-normal text-[color:var(--color-text)]">
            Early
          </span>
          <span className="font-[var(--font-inter)] font-bold text-[color:var(--color-text)]">
            Insider
          </span>
        </Link>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right side */}
        <div className="hidden md:flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-[color:var(--color-muted)] hover:text-[color:var(--color-text)]"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center h-10 px-6 text-sm font-semibold uppercase tracking-wider text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Start Free
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {mobileOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div id="mobile-nav" role="navigation" aria-label="Mobile menu" className="md:hidden border-t border-[var(--color-border-light)] bg-white px-6 py-4 space-y-3">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block text-sm font-medium text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="block text-sm font-medium text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="block w-full text-center h-10 leading-10 text-sm font-semibold uppercase tracking-wider text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            Start Free
          </Link>
        </div>
      )}
    </header>
  );
}
