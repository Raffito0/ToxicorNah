import { useState, useEffect } from 'react';
import { SoulTypeMedia } from './SoulTypeMedia';
import { ToxicOrb } from './ToxicOrb';
import { loadSharedAnalysis, type ShareableCardData } from '../services/shareService';

function getToxicityLabel(score: number): string {
  if (score <= 30) return 'Barely a Red Flag';
  if (score <= 50) return 'Low-key Toxic';
  if (score <= 65) return 'Certified Toxic';
  if (score <= 80) return 'Dangerously Toxic';
  return 'Run.';
}

interface ShareLandingPageProps {
  shareId: string;
}

export function ShareLandingPage({ shareId }: ShareLandingPageProps) {
  const [data, setData] = useState<ShareableCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadSharedAnalysis(shareId)
      .then((result) => {
        if (result) {
          setData(result);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [shareId]);

  function handleOpenApp() {
    const deepLink = `toxicornah://share/${shareId}`;
    const timeout = setTimeout(() => {
      // Deep link failed — redirect to app store
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        window.location.href = 'https://apps.apple.com/app/toxic-or-nah/id6740043800';
      } else {
        window.location.href = 'https://play.google.com/store/apps/details?id=com.toxicornah.app';
      }
    }, 1500);

    window.location.href = deepLink;
    window.addEventListener('blur', () => clearTimeout(timeout), { once: true });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#111111' }}>
        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-8" style={{ background: '#111111' }}>
        <img src="/logo-group59.png" alt="Toxic or Nah?" style={{ height: '32px' }} />
        <p className="text-white/50 text-center" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: '16px' }}>
          This analysis is no longer available.
        </p>
        <button
          onClick={handleOpenApp}
          className="mt-4 px-8 py-3.5 rounded-full active:scale-95 transition-all"
          style={{ background: '#7200B4', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 400, letterSpacing: '1.5px' }}
        >
          <span className="text-white" style={{ fontSize: '15px' }}>Open Toxic or Nah</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: '#111111' }}
    >
      {/* Card */}
      <div
        className="w-full rounded-[24px] overflow-hidden relative"
        style={{
          maxWidth: '340px',
          aspectRatio: '9/16',
          backgroundColor: '#111111',
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        <SoulTypeMedia
          src={data.soulTypeImageUrl}
          alt={data.soulTypeTitle}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.8) 100%)' }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-2px',
            left: '-2px',
            right: '-2px',
            height: 'calc(45% + 2px)',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.35) 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
          }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 px-5 pb-10 flex flex-col items-center text-center"
          style={{ zIndex: 10 }}
        >
          <h3
            style={{
              fontSize: '31px',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 500,
              letterSpacing: '1.5px',
              lineHeight: '1.3',
              color: '#FFFFFF',
            }}
          >
            {data.soulTypeTitle}
          </h3>
          <p
            className="mt-2"
            style={{
              fontSize: '18px',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontWeight: 200,
              letterSpacing: '1.5px',
              color: 'rgba(255, 255, 255, 0.7)',
              fontStyle: 'italic',
            }}
          >
            {data.soulTypeTagline}
          </p>
          <div className="flex items-center justify-center gap-2.5 mt-4">
            <ToxicOrb score={data.overallScore} size={46} fontSizeOverride={16} />
            <div className="flex flex-col items-start">
              <span
                className="text-white font-bold"
                style={{ fontSize: '19px', fontFamily: 'Satoshi, sans-serif' }}
              >
                {getToxicityLabel(data.overallScore)}
              </span>
              <span
                className="text-white/40"
                style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                Toxicity Score
              </span>
            </div>
          </div>
          <img
            src="/logo-group59.png"
            alt="Toxic or Nah?"
            className="mt-5"
            style={{ height: '28px' }}
          />
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={handleOpenApp}
        className="mt-8 w-full flex items-center justify-center gap-2 px-8 py-4 rounded-full active:scale-95 transition-all"
        style={{
          maxWidth: '340px',
          background: '#7200B4',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontWeight: 400,
          letterSpacing: '1.5px',
        }}
      >
        <span className="text-white font-medium" style={{ fontSize: '16px' }}>
          Get the Full Analysis
        </span>
      </button>

      <p
        className="mt-4 text-white/30 text-center"
        style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 300 }}
      >
        Scan any chat. Know the truth.
      </p>
    </div>
  );
}
