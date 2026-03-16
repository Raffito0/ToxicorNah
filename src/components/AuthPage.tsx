import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface AuthPageProps {
  onAuthSuccess: () => void;
}

export function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [showLogin, setShowLogin] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [resendTimer, setResendTimer] = useState(30);

  const words = ['Crush', 'Ex', 'Partner'];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentWordIndex((prev) => (prev + 1) % words.length);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (showVerificationModal && resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [showVerificationModal, resendTimer]);

  async function handleQuickSignUp() {
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signUp({
        email: `user_${Date.now()}@toxicornah.app`,
        password: Math.random().toString(36).slice(-8),
      });
      if (error) throw error;
      onAuthSuccess();
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password: password || Math.random().toString(36).slice(-8),
      });
      if (error) throw error;
      onAuthSuccess();
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    const code = verificationCode.join('');
    if (code.length !== 6) {
      setError('Enter the full code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email'
      });
      if (error) throw error;
      onAuthSuccess();
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    if (resendTimer > 0) return;

    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      setResendTimer(30);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  function handleCodeInput(index: number, value: string) {
    if (value.length > 1) {
      value = value[0];
    }

    const newCode = [...verificationCode];
    newCode[index] = value;
    setVerificationCode(newCode);

    if (value && index < 5) {
      const nextInput = document.getElementById(`code-input-${index + 1}`);
      nextInput?.focus();
    }
  }

  function handleCodeKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !verificationCode[index] && index > 0) {
      const prevInput = document.getElementById(`code-input-${index - 1}`);
      prevInput?.focus();
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      setShowVerificationModal(true);
      setResendTimer(30);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleAppleSignIn() {
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  }

  if (showLogin) {
    return (
      <>
      <div
        className="min-h-screen bg-black text-white flex flex-col items-center justify-center transition-all duration-300"
        style={{
          paddingLeft: '30px',
          paddingRight: '30px',
          filter: showVerificationModal ? 'blur(8px)' : 'none'
        }}
      >
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-12">
            <img
              src="/Screenshot_2026-01-27_225502-removebg-preview.png"
              alt="Toxic or Nah Logo"
              style={{ width: '62px', height: '62px', marginBottom: '6px' }}
            />
            <h1
              className="text-white text-center font-bold mb-1"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '24px', lineHeight: '1.2' }}
            >
              Log in to your account
            </h1>
            <h2
              className="text-white text-center font-bold"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '24px', lineHeight: '1.2' }}
            >
              Toxic or Nah
            </h2>
          </div>

          <div className="space-y-3 mb-4">
            <button
              onClick={handleAppleSignIn}
              disabled={loading}
              className="w-full bg-black border border-white/20 rounded-full px-6 hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '15px', height: '40px' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              Sign in with Apple
            </button>

            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full bg-black border border-white/20 rounded-full px-6 hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '15px', height: '40px' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>
          </div>

          <div className="flex items-center justify-center" style={{ marginTop: '20px', marginBottom: '20px' }}>
            <span
              className="text-zinc-500 text-sm"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Or
            </span>
          </div>

          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full bg-zinc-900/50 border-none rounded-3xl px-6 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '16px', height: '40px' }}
            />

            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded-2xl px-4 py-3">
                <p className="text-red-400 text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white rounded-full px-6 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-base"
              style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px',
                background: 'linear-gradient(135deg, #B794F4 0%, #8B5CF6 100%)',
                fontSize: '16px',
                fontWeight: 600,
                height: '40px'
              }}
            >
              {loading ? 'Signing in...' : 'Log in'}
            </button>
          </form>

          <div className="flex items-center justify-center mt-4">
            <span
              className="text-zinc-500 text-sm"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Don't have an account?{' '}
              <button
                onClick={() => {
                  setShowLogin(false);
                  setShowSignUp(true);
                }}
                className="text-white underline hover:opacity-80 transition-opacity"
                style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                Sign up
              </button>
            </span>
          </div>
        </div>
      </div>

        {showVerificationModal && (
          <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm">
            <div
              className="bg-zinc-900 rounded-3xl p-8 w-full max-w-md mx-8"
              style={{
                animation: 'fadeIn 0.3s ease-out'
              }}
            >
              <div className="flex flex-col items-center mb-6">
                <div className="mb-4">
                  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                    <rect width="64" height="64" rx="12" fill="#1f1f1f"/>
                    <path
                      d="M16 24L32 34L48 24M16 24V40C16 41.1046 16.8954 42 18 42H46C47.1046 42 48 41.1046 48 40V24M16 24L30 18C31.2 17.4 32.8 17.4 34 18L48 24"
                      stroke="#6E5BFF"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <h2
                  className="text-white text-center font-bold mb-2"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '24px' }}
                >
                  Check your Email
                </h2>
                <p
                  className="text-zinc-400 text-center text-sm"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                >
                  We sent a 6-digit code<br />to {email}
                </p>
              </div>

              <div className="flex justify-center gap-2 mb-6">
                {verificationCode.map((digit, index) => (
                  <input
                    key={index}
                    id={`code-input-${index}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeInput(index, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(index, e)}
                    className="w-10 h-14 bg-zinc-800 border-none rounded-xl text-white text-center text-xl focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                  />
                ))}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-2xl px-4 py-3 mb-4">
                  <p className="text-red-400 text-sm text-center" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                    {error}
                  </p>
                </div>
              )}

              <button
                onClick={handleVerifyCode}
                disabled={loading || verificationCode.join('').length !== 6}
                className="w-full text-white rounded-full px-6 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mb-4"
                style={{
                  fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px',
                  background: 'linear-gradient(135deg, #B794F4 0%, #8B5CF6 100%)',
                  fontSize: '16px',
                  fontWeight: 600,
                  height: '48px'
                }}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>

              <button
                onClick={handleResendCode}
                disabled={resendTimer > 0}
                className="w-full text-zinc-400 text-sm hover:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                {resendTimer > 0 ? `Resend code (${resendTimer}s)` : 'Resend code'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (showSignUp) {
    return (
      <>
        <div
          className="min-h-screen bg-black text-white flex flex-col items-center justify-center transition-all duration-300"
          style={{
            paddingLeft: '30px',
            paddingRight: '30px',
            filter: showVerificationModal ? 'blur(8px)' : 'none'
          }}
        >
          <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-12">
            <img
              src="/Screenshot_2026-01-27_225502-removebg-preview.png"
              alt="Toxic or Nah Logo"
              style={{ width: '62px', height: '62px', marginBottom: '6px' }}
            />
            <h1
              className="text-white text-center font-bold mb-1"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '24px', lineHeight: '1.2' }}
            >
              Create your account
            </h1>
            <h2
              className="text-white text-center font-bold"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '24px', lineHeight: '1.2' }}
            >
              Toxic or Nah
            </h2>
          </div>

          <div className="space-y-3 mb-4">
            <button
              onClick={handleAppleSignIn}
              disabled={loading}
              className="w-full bg-black border border-white/20 rounded-full px-6 hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '15px', height: '40px' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              Continue with Apple
            </button>

            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full bg-black border border-white/20 rounded-full px-6 hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '15px', height: '40px' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </div>

          <div className="flex items-center justify-center" style={{ marginTop: '20px', marginBottom: '20px' }}>
            <span
              className="text-zinc-500 text-sm"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Or
            </span>
          </div>

          <form onSubmit={handleSignUp} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full bg-zinc-900/50 border-none rounded-3xl px-6 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '16px', height: '40px' }}
            />

            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded-2xl px-4 py-3">
                <p className="text-red-400 text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white rounded-full px-6 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-base"
              style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px',
                background: 'linear-gradient(135deg, #B794F4 0%, #8B5CF6 100%)',
                fontSize: '16px',
                fontWeight: 600,
                height: '40px'
              }}
            >
              {loading ? 'Signing up...' : 'Sign up'}
            </button>
          </form>

          <div className="flex items-center justify-center mt-4">
            <span
              className="text-zinc-500 text-sm"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Already have an account?{' '}
              <button
                onClick={() => {
                  setShowSignUp(false);
                  setShowLogin(true);
                }}
                className="text-white underline hover:opacity-80 transition-opacity"
                style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                Log in
              </button>
            </span>
          </div>
        </div>
      </div>

        {showVerificationModal && (
          <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm">
            <div
              className="bg-zinc-900 rounded-3xl p-8 w-full max-w-md mx-8"
              style={{
                animation: 'fadeIn 0.3s ease-out'
              }}
            >
              <div className="flex flex-col items-center mb-6">
                <div className="mb-4">
                  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                    <rect width="64" height="64" rx="12" fill="#1f1f1f"/>
                    <path
                      d="M16 24L32 34L48 24M16 24V40C16 41.1046 16.8954 42 18 42H46C47.1046 42 48 41.1046 48 40V24M16 24L30 18C31.2 17.4 32.8 17.4 34 18L48 24"
                      stroke="#6E5BFF"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <h2
                  className="text-white text-center font-bold mb-2"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '24px' }}
                >
                  Check your Email
                </h2>
                <p
                  className="text-zinc-400 text-center text-sm"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                >
                  We sent a 6-digit code<br />to {email}
                </p>
              </div>

              <div className="flex justify-center gap-2 mb-6">
                {verificationCode.map((digit, index) => (
                  <input
                    key={index}
                    id={`code-input-${index}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeInput(index, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(index, e)}
                    className="w-10 h-14 bg-zinc-800 border-none rounded-xl text-white text-center text-xl focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                  />
                ))}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-2xl px-4 py-3 mb-4">
                  <p className="text-red-400 text-sm text-center" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                    {error}
                  </p>
                </div>
              )}

              <button
                onClick={handleVerifyCode}
                disabled={loading || verificationCode.join('').length !== 6}
                className="w-full text-white rounded-full px-6 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mb-4"
                style={{
                  fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px',
                  background: 'linear-gradient(135deg, #B794F4 0%, #8B5CF6 100%)',
                  fontSize: '16px',
                  fontWeight: 600,
                  height: '48px'
                }}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>

              <button
                onClick={handleResendCode}
                disabled={resendTimer > 0}
                className="w-full text-zinc-400 text-sm hover:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                {resendTimer > 0 ? `Resend code (${resendTimer}s)` : 'Resend code'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className="min-h-screen text-white flex flex-col items-center justify-center relative"
      style={{
        backgroundColor: '#000000',
      }}
    >
      {/* Background image */}
      <img
        src="/screencapture-localhost-5173-2026-02-04-2asdasd2_35_32(1).jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Dark overlay */}
      <div className="absolute inset-0" style={{ background: 'rgba(0, 0, 0, 0.05)' }} />
      <div className="w-full max-w-md relative z-10" style={{ paddingLeft: '30px', paddingRight: '30px', paddingTop: '40px', paddingBottom: '40px' }}>
        <div className="flex items-center gap-3 mb-5">
          <img
            src="/Screenshot_2026-01-27_225502-removebg-preview.png"
            alt="Toxic or Nah"
            style={{ height: '38px', filter: 'brightness(0) invert(1)' }}
          />
        </div>

        <h1 className="leading-tight mb-4" style={{ fontFamily: 'Satoshi, sans-serif', fontWeight: 700, fontSize: '38.29px' }}>
          How <span style={{
            background: 'linear-gradient(135deg, #d3a659 0%, #c64d59 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>Toxic</span> is your<br /><span
            key={currentWordIndex}
            style={{
              background: 'linear-gradient(135deg, #B794F4 0%, #8B5CF6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              display: 'inline-block',
              animation: 'fadeBlur 3s ease-in-out'
            }}
          >{words[currentWordIndex]}?</span>
        </h1>

        <p className="text-base" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.7)' }}>
          Analyze your chats and find out what they really think
        </p>

        <div style={{ marginTop: '200px' }}>
          <div className="flex items-center justify-center gap-2 mb-5" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '13px', color: 'rgba(255, 255, 255, 0.6)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span>100% anonymous and secure</span>
          </div>

          <button
            onClick={onAuthSuccess}
            disabled={loading}
            className="w-full text-white rounded-full px-6 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontWeight: 400,
              letterSpacing: '1.5px',
              background: '#7200B4',
              height: '48px',
              fontSize: '15px'
            }}
          >
            {loading ? 'LOADING...' : 'START FOR FREE'}
          </button>

          <button
            onClick={() => setShowLogin(true)}
            className="w-full font-semibold underline hover:opacity-80 transition-opacity"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)' }}
          >
            Log in
          </button>

          <p className="text-center mt-5 leading-relaxed" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            <span style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)' }}>No credit card required</span><br />
            <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>By continuing you accept Terms & Privacy.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
