"use client";

import { useState } from "react";

const FAQS = [
  {
    q: "Is tracking insider buying legal?",
    a: "Yes. All data comes from SEC Form 4 filings, which are public records. Company insiders are legally required to report their trades within 2 business days.",
  },
  {
    q: "How fast are the alerts?",
    a: "Pro members receive alerts within 60 seconds of the SEC filing. Free members see the same data delayed by 15 minutes.",
  },
  {
    q: "Is this financial advice?",
    a: "No. EarlyInsider provides data and AI-powered analysis of publicly available SEC filings. All investment decisions are yours. We are not registered investment advisors.",
  },
  {
    q: "Can I create a custom watchlist?",
    a: "Yes, Pro members can create unlimited watchlists and receive alerts only for the stocks they track.",
  },
  {
    q: "How is this different from OpenInsider?",
    a: "OpenInsider shows raw data with a delay. We provide real-time alerts within 60 seconds, AI analysis on every trade, conviction scoring, historical pattern matching, and a clean interface designed for action.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel your Pro subscription at any time with one click. No contracts, no cancellation fees.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="bg-[var(--color-bg-alt)] py-20">
      <div className="mx-auto max-w-[700px] px-6">
        <h2 className="text-3xl text-center text-[color:var(--color-text)] mb-12">
          Frequently Asked Questions
        </h2>

        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-[var(--color-border)]"
            >
              <button
                className="w-full flex items-center justify-between p-5 text-left"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                aria-expanded={openIndex === i}
              >
                <span className="text-sm font-medium text-[color:var(--color-text)] pr-4">
                  {faq.q}
                </span>
                <span className="text-[color:var(--color-muted)] shrink-0 text-lg">
                  {openIndex === i ? "−" : "+"}
                </span>
              </button>
              {openIndex === i && (
                <div className="px-5 pb-5 text-sm text-[color:var(--color-muted)] leading-relaxed">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
