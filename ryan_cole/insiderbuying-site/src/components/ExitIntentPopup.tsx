"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { EmailCapture } from "./EmailCapture";

const HIDDEN_PATHS = ["/signup", "/login", "/free-report"];
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function ExitIntentPopup() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  const trigger = useCallback(() => {
    if (localStorage.getItem("ei_subscribed") === "1") return;
    const lastShown = localStorage.getItem("ei_popup_last");
    if (lastShown && Date.now() - parseInt(lastShown) < COOLDOWN_MS) return;
    setShow(true);
    localStorage.setItem("ei_popup_last", String(Date.now()));
  }, []);

  useEffect(() => {
    if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return;
    if (localStorage.getItem("ei_subscribed") === "1") return;

    // Desktop: mouseleave on top of viewport
    function onMouseLeave(e: MouseEvent) {
      if (e.clientY <= 5) trigger();
    }

    // Mobile: scroll up quickly (alternative to exit intent)
    let lastScrollY = window.scrollY;
    let scrollUpCount = 0;
    function onScroll() {
      const delta = lastScrollY - window.scrollY;
      lastScrollY = window.scrollY;
      if (delta > 30 && window.scrollY > 400) {
        scrollUpCount++;
        if (scrollUpCount >= 3) {
          trigger();
          scrollUpCount = 0;
        }
      } else if (delta < 0) {
        scrollUpCount = 0;
      }
    }

    document.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname, trigger]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-[20px]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={() => setShow(false)}
      />

      {/* Modal */}
      <div className="relative bg-[var(--color-bg-dark)] p-[32px] md:p-[48px] max-w-[520px] w-full shadow-2xl animate-[fadeIn_0.2s_ease-out]">
        <button
          onClick={() => setShow(false)}
          className="absolute top-[16px] right-[16px] text-white/40 hover:text-white/70 transition-colors"
          aria-label="Close"
        >
          <svg className="w-[20px] h-[20px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>

        <p className="text-[11px] font-[var(--font-mono)] tracking-[2px] text-[var(--color-primary)] uppercase mb-[12px]">
          Before you go
        </p>

        <EmailCapture
          heading="The Data Is Public. The Speed Is Not."
          subheading="SEC Form 4 filings are public. But 25% of abnormal returns accrue in the first 5 trading days. The CEO Alpha Report identifies which insider buys scored 75+ conviction. Monthly. Free."
          ctaText="Get the Free Report"
          placement="exit_intent"
          dark
        />

        <button
          onClick={() => setShow(false)}
          className="mt-[16px] text-[12px] text-white/30 hover:text-white/50 transition-colors"
        >
          No thanks, I&apos;ll check EDGAR manually
        </button>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
