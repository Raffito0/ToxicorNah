"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SignUpPage() {
  const [plan, setPlan] = useState<"free" | "pro">("free");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setSuccess(true);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setSuccess(true);
    setLoading(false);
  }

  async function handleGoogle() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    });
  }

  return (
    <div className="flex min-h-[calc(100vh-82px)]">

      {/* ═══ LEFT PANEL — Navy branding ═══ */}
      <div className="hidden lg:flex w-[50%] bg-[#002a5e] relative overflow-hidden">
        {/* Decorative overlay */}
        <div className="absolute inset-0 opacity-20 bg-gradient-to-br from-transparent to-black/20" />

        {/* Decorative chart line */}
        <div className="absolute bottom-0 left-0 right-0 h-[300px] opacity-[0.03]">
          <svg className="w-full h-full" viewBox="0 0 960 300" fill="none" preserveAspectRatio="none">
            <path d="M0 280 C100 260 200 240 300 200 S500 120 600 100 S800 40 960 20" stroke="white" strokeWidth="3" />
          </svg>
        </div>

        {/* Decorative circle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] opacity-10">
          <svg viewBox="0 0 400 400" fill="none">
            <circle cx="200" cy="200" r="190" stroke="white" strokeWidth="2" />
            <circle cx="100" cy="100" r="4" fill="white" />
            <circle cx="300" cy="300" r="4" fill="white" />
          </svg>
        </div>

        <div className="relative z-10 flex flex-col justify-between h-full px-[64px] py-[40px]">
          {/* Top — Logo */}
          <div className="flex items-baseline">
            <span className="text-[24px] leading-[32px] text-white font-normal">Early</span>
            <span className="text-[24px] leading-[32px] text-white font-bold">&nbsp;Insider</span>
          </div>

          {/* Middle — Headline + bullets */}
          <div>
            <h1 className="font-[var(--font-montaga)] text-[54px] font-normal leading-[63px] text-white mb-[40px]">
              Know what CEOs are buying,<br />Before everyone else.
            </h1>

            <ul className="space-y-[16px]">
              {[
                "Real-time SEC Form 4 alerts",
                "AI-powered analysis on every trade",
                "Custom watchlist for your portfolio",
              ].map((item) => (
                <li key={item} className="flex items-center gap-[12px]">
                  <svg className="w-[15px] h-[15px] shrink-0" viewBox="0 0 15 15" fill="#00d26a"><circle cx="7.5" cy="7.5" r="7.5" /></svg>
                  <span className="text-[16px] font-normal leading-[50px] text-white">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Bottom — Stats */}
          <div>
            <p className="text-[16px] font-normal leading-[20px] text-white uppercase tracking-[2px] mb-[8px]">
              Tracking $4.2B+ in insider transactions
            </p>
            <p className="text-[14px] font-normal leading-[23px] text-white/70 italic">
              &ldquo;The average insider buy we track returns 12.4% within 6 months.&rdquo;
            </p>
          </div>
        </div>
      </div>

      {/* ═══ RIGHT PANEL — Form ═══ */}
      <div className="flex-1 bg-white flex items-center justify-center px-[20px] md:px-[40px] py-[40px]">
        <div className="w-full max-w-[420px]">

          {/* Already have account */}
          <p className="text-[12px] font-normal leading-[15px] text-black mb-[32px]">
            Already have an account?{" "}
            <Link href="/login" className="text-[#000ad2] hover:underline">Log in</Link>
          </p>

          {success ? (
            <div className="text-center py-[40px]">
              <h2 className="text-[24px] font-bold leading-[32px] text-[#002a5e] mb-[16px]">Check your email</h2>
              <p className="text-[14px] leading-[20px] text-[#454556]">
                We sent a confirmation link to <strong>{email}</strong>.<br />Click it to activate your account.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-[24px] font-bold leading-[32px] text-[#002a5e] mb-[24px]">
                Create your account
              </h2>

              {/* Plan Toggle */}
              <div className="bg-[#f5f6f8] rounded-[8px] flex p-[4px] mb-[20px]">
                <button
                  onClick={() => setPlan("free")}
                  className={`flex-1 h-[35px] rounded-[8px] text-[14px] font-medium leading-[20px] transition-all ${
                    plan === "free" ? "bg-white text-[#002a5e] shadow-[0px_1px_2px_rgba(0,0,0,0.06)]" : "text-[#454556]"
                  }`}
                >
                  Free
                </button>
                <button
                  onClick={() => setPlan("pro")}
                  className={`flex-1 h-[35px] rounded-[8px] text-[14px] font-medium leading-[20px] flex items-center justify-center gap-[6px] transition-all ${
                    plan === "pro" ? "bg-white text-[#002a5e] shadow-[0px_1px_2px_rgba(0,0,0,0.06)]" : "text-[#454556]"
                  }`}
                >
                  <span>Analyst</span>
                  <span className="text-[12px] font-semibold leading-[20px] text-[#179b56]">$24/mo</span>
                </button>
              </div>

              {/* Google OAuth */}
              <button
                onClick={handleGoogle}
                className="w-full h-[46px] flex items-center justify-center gap-[10px] rounded-[8px] border border-[#d1d6da] text-[14px] font-medium leading-[20px] text-[#1c1b1b] hover:bg-[#f6f3f2] transition-colors mb-[20px]"
              >
                <svg className="w-[20px] h-[20px]" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              {/* Divider */}
              <div className="flex items-center gap-[12px] mb-[20px]">
                <div className="flex-1 h-[1px] bg-[#d1d6da]" />
                <span className="text-[12px] font-normal leading-[16px] text-[#454556]">or email</span>
                <div className="flex-1 h-[1px] bg-[#d1d6da]" />
              </div>

              {/* Form */}
              <form onSubmit={handleSignUp} className="space-y-[16px]">
                <div>
                  <label className="block text-[12px] font-bold leading-[16px] text-[#454556] mb-[8px]">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full h-[46px] px-[12px] bg-white border border-[#d1d6da] text-[14px] font-normal leading-[20px] text-[#1c1b1b] placeholder:text-[#a0a8b1] focus:outline-none focus:border-[#000592] focus:ring-1 focus:ring-[#000592]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold leading-[16px] text-[#454556] mb-[8px]">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="name@company.com"
                    className="w-full h-[46px] px-[12px] bg-white border border-[#d1d6da] text-[14px] font-normal leading-[20px] text-[#1c1b1b] placeholder:text-[#a0a8b1] focus:outline-none focus:border-[#000592] focus:ring-1 focus:ring-[#000592]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold leading-[16px] text-[#454556] mb-[8px]">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="Min. 8 characters"
                    className="w-full h-[46px] px-[12px] bg-white border border-[#d1d6da] text-[14px] font-normal leading-[20px] text-[#1c1b1b] placeholder:text-[#a0a8b1] focus:outline-none focus:border-[#000592] focus:ring-1 focus:ring-[#000592]"
                  />
                </div>

                {error && (
                  <p className="text-[13px] text-[#ba1a1a]">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[55px] bg-[#080f99] text-white text-[16px] font-medium leading-[24px] uppercase tracking-[1px] hover:bg-[#000592] transition-colors disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create Account"}
                </button>
              </form>

              {/* Terms */}
              <p className="mt-[16px] text-[12px] font-normal leading-[15px] text-black">
                By creating an account, you agree to our{" "}
                <Link href="/terms" className="text-[#000ad2] underline">Terms of Service</Link>
                {" "}and{" "}
                <Link href="/privacy" className="text-[#000ad2] underline">Privacy Policy</Link>.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
