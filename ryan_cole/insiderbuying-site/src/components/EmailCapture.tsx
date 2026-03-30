"use client";

import { useState } from "react";

interface EmailCaptureProps {
  heading?: string;
  subheading?: string;
  bullets?: string[];
  ctaText?: string;
  trustLine?: string;
  placement?: string;
  variant?: "hero" | "inline" | "compact";
  dark?: boolean;
}

export function EmailCapture({
  heading = "The CEO Alpha Report",
  subheading = "50,247 CEO stock purchases. 12 years of data. 7 filters that separated the 23.4% winners from the noise. Updated monthly. Free.",
  bullets,
  ctaText = "Get the Free Report",
  trustLine = "No spam. One email with the report. Unsubscribe anytime.",
  placement = "unknown",
  variant = "inline",
  dark = false,
}: EmailCaptureProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), placement, source: "earlyinsider.com" }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Something went wrong");
      }

      setState("success");
      localStorage.setItem("ei_subscribed", "1");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (state === "success") {
    return (
      <div className={`text-center py-[32px] ${dark ? "text-white" : "text-[color:var(--color-text)]"}`}>
        <svg className="w-[48px] h-[48px] mx-auto mb-[16px] text-[var(--color-signal-green)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-[20px] font-medium mb-[8px]">You&apos;re in.</p>
        <p className={`text-[14px] ${dark ? "text-white/60" : "text-[color:var(--color-text-muted)]"}`}>
          Check your inbox for the CEO Alpha Report.
        </p>
      </div>
    );
  }

  const textColor = dark ? "text-white" : "text-[color:var(--color-text)]";
  const mutedColor = dark ? "text-white/60" : "text-[color:var(--color-text-muted)]";
  const secondaryColor = dark ? "text-white/70" : "text-[color:var(--color-text-secondary)]";

  if (variant === "compact") {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-[8px] w-full max-w-[480px]">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className={`flex-1 h-[44px] px-[16px] text-[14px] border ${
            dark
              ? "bg-white/10 border-white/20 text-white placeholder:text-white/40"
              : "bg-white border-[var(--color-border)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-muted)]"
          } focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]`}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="h-[44px] px-[24px] bg-[var(--color-primary)] text-white text-[14px] font-medium tracking-[0.5px] hover:bg-[var(--color-primary-dark)] transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {state === "loading" ? "..." : ctaText}
        </button>
      </form>
    );
  }

  return (
    <div className={variant === "hero" ? "max-w-[600px]" : "max-w-[540px]"}>
      {heading && (
        <h3 className={`font-[var(--font-montaga)] ${variant === "hero" ? "text-[32px] md:text-[39px]" : "text-[24px] md:text-[28px]"} leading-[1.15] tracking-[0.5px] ${textColor} mb-[12px]`}>
          {heading}
        </h3>
      )}
      {subheading && (
        <p className={`text-[15px] leading-[22px] ${secondaryColor} mb-[20px]`}>
          {subheading}
        </p>
      )}
      {bullets && bullets.length > 0 && (
        <ul className="space-y-[10px] mb-[24px]">
          {bullets.map((b) => (
            <li key={b} className={`flex items-start gap-[10px] text-[14px] leading-[20px] ${textColor}`}>
              <svg className="w-[11px] h-[8px] shrink-0 mt-[6px]" viewBox="0 0 11 8">
                <path d="M1 4l3 3L10 1" stroke={dark ? "#10B981" : "#006d34"} strokeWidth="2" fill="none" />
              </svg>
              {b}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-[8px] mb-[10px]">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className={`flex-1 h-[50px] px-[16px] text-[15px] border ${
            dark
              ? "bg-white/10 border-white/20 text-white placeholder:text-white/40"
              : "bg-white border-[var(--color-border)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-muted)]"
          } focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]`}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="h-[50px] px-[28px] bg-[var(--color-primary)] text-white text-[16px] font-medium tracking-[0.5px] hover:bg-[var(--color-primary-dark)] transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {state === "loading" ? "Subscribing..." : ctaText}
        </button>
      </form>
      {state === "error" && (
        <p className="text-[13px] text-[var(--color-signal-red)] mb-[4px]">{errorMsg}</p>
      )}
      {trustLine && (
        <p className={`text-[12px] ${mutedColor}`}>{trustLine}</p>
      )}
    </div>
  );
}
