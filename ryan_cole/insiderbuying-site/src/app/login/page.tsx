"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/alerts";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      window.location.href = redirectTo;
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    window.location.href = redirectTo;
  }

  async function handleGoogle() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}` },
    });
  }

  async function handleForgotPassword() {
    if (!email) {
      setError("Enter your email address first, then click Forgot password.");
      return;
    }
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login?reset=true`,
    });
    if (error) {
      setError(error.message);
    } else {
      setResetSent(true);
    }
    setLoading(false);
  }

  return (
    <div className="bg-white min-h-[calc(100vh-82px)] flex items-center justify-center px-[20px] md:px-[32px] py-[40px] md:py-[60px]">
      <div className="w-full max-w-[420px] bg-white p-[20px] md:p-[48px]">

        {/* Logo */}
        <div className="mb-[32px]">
          <span className="text-[20px] font-normal leading-[30px] text-[#1a1a1a]">EarlyInsider</span>
        </div>

        {/* Title */}
        <div className="mb-[40px]">
          <h2 className="font-[var(--font-montaga)] text-[28px] font-normal leading-[35px] text-[#1a1a1a]">
            Welcome back
          </h2>
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogle}
          className="w-full h-[48px] flex items-center justify-center gap-[12px] rounded-[8px] border border-[#d1d6da] bg-white hover:bg-[#f6f3f2] transition-colors mb-[32px]"
        >
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span className="text-[15px] font-medium leading-[22px] text-[#1a1a1a]">Continue with Google</span>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-[16px] mb-[32px]">
          <div className="w-[139px] h-[1px] bg-[#d1d6da]" />
          <span className="text-[14px] font-normal leading-[21px] text-[#5c6670]">or</span>
          <div className="w-[139px] h-[1px] bg-[#d1d6da]" />
        </div>

        {/* Form */}
        <form onSubmit={handleLogin}>
          <div className="flex flex-col gap-[24px] mb-[24px]">
            {/* Email */}
            <div className="flex flex-col gap-[8px]">
              <label className="text-[14px] font-medium leading-[21px] text-[#1a1a1a]">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="name@company.com"
                className="w-full max-w-full h-[44px] px-[16px] py-[11px] bg-white rounded-[8px] border border-[#d1d6da] text-[15px] font-normal leading-[18px] text-[#1a1a1a] placeholder:text-[#c6c5d9] focus:outline-none focus:border-[#000592] focus:ring-1 focus:ring-[#000592]"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-[8px]">
              <div className="flex items-center justify-between w-full max-w-full">
                <label className="text-[14px] font-medium leading-[21px] text-[#1a1a1a]">Password</label>
                <button type="button" onClick={handleForgotPassword} className="text-[14px] font-normal leading-[21px] text-[#0075e2] hover:underline">
                  Forgot password?
                </button>
              </div>
              <div className="relative w-full max-w-full">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full h-[44px] px-[16px] pr-[48px] py-[11px] bg-white rounded-[8px] border border-[#d1d6da] text-[15px] font-normal leading-[18px] text-[#1a1a1a] placeholder:text-[#c6c5d9] focus:outline-none focus:border-[#000592] focus:ring-1 focus:ring-[#000592]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-[16px] top-1/2 -translate-y-1/2 text-[#5c6670] hover:text-[#1a1a1a]"
                >
                  <svg className="w-[18px] h-[12px]" viewBox="0 0 18 12" fill="currentColor">
                    <path d="M9 0C5 0 1.7 2.4.3 6c1.4 3.6 4.7 6 8.7 6s7.3-2.4 8.7-6C16.3 2.4 13 0 9 0zm0 10c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4zm0-6.5C7.6 3.5 6.5 4.6 6.5 6S7.6 8.5 9 8.5 11.5 7.4 11.5 6 10.4 3.5 9 3.5z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {resetSent && (
            <p className="text-[13px] text-[#006d34] mb-[8px]">Password reset link sent to <strong>{email}</strong>. Check your inbox.</p>
          )}

          {error && (
            <p className="text-[13px] text-[#ba1a1a] mb-[8px]">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full max-w-full h-[48px] bg-[#080f99] text-white text-[15px] font-semibold leading-[22px] hover:bg-[#000592] transition-colors disabled:opacity-50 mt-[8px]"
          >
            {loading ? "Signing in..." : "Log In"}
          </button>
        </form>

        {/* Bottom text */}
        <p className="mt-[32px] text-[14px] font-normal leading-[21px] text-[#5c6670]">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[#0075e2] hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
