import { useRef, useEffect, useState, useCallback } from 'react';
import { toPng } from 'html-to-image';
import { Lock } from 'lucide-react';
import { getColorAtPercentage } from './ScoreRing';

interface ShareableCardProps {
  score: number;
  personArchetype: {
    title: string;
    imageUrl: string;
    shareableTagline: string;
  };
  personGender: 'male' | 'female';
  gradientFrom: string;
  gradientTo: string;
  userQuote: string;
  onQuoteChange: (quote: string) => void;
  isFirstTimeFree?: boolean;
  onPaywallOpen?: () => void;
}

// Rarity percentages per archetype (how uncommon each type is)
const ARCHETYPE_RARITY: Record<string, number> = {
  'The Phantom': 12,
  'The Sweet Poison': 15,
  'The Puppeteer': 9,
  'The Anchor': 22,
  'The Slow Burn': 18,
};

function MiniScoreRing({ score, maxScore = 100 }: { score: number; maxScore?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 56;
  const radius = 22;
  const strokeWidth = 4;
  const percentage = score / maxScore;
  const color = getColorAtPercentage(percentage);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

    // Score arc
    const segments = 360;
    const totalSegments = Math.floor(segments * percentage);
    for (let i = 0; i < totalSegments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;
      const t = i / segments;
      const segColor = getColorAtPercentage(t);

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, angle - Math.PI / 2, nextAngle - Math.PI / 2);
      ctx.strokeStyle = segColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }, [score, maxScore, percentage]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <canvas ref={canvasRef} width={size} height={size} className="absolute inset-0" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="font-bold leading-none"
          style={{ fontSize: '16px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color }}
        >
          {score}
        </span>
      </div>
    </div>
  );
}

function getToxicityLabel(score: number): string {
  if (score <= 30) return 'Barely a Red Flag';
  if (score <= 50) return 'Low-key Toxic';
  if (score <= 65) return 'Certified Toxic';
  if (score <= 80) return 'Dangerously Toxic';
  return 'Run.';
}

export function ShareableCard({
  score,
  personArchetype,
  personGender,
  gradientFrom,
  gradientTo,
  userQuote,
  onQuoteChange,
  isFirstTimeFree = false,
  onPaywallOpen
}: ShareableCardProps) {
  const maxChars = 120;
  const rarity = ARCHETYPE_RARITY[personArchetype.title] || 14;
  const pronoun = personGender === 'female' ? 'her' : 'him';
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);

  // Pre-convert archetype image to base64 so html-to-image can inline it
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setImageDataUrl(canvas.toDataURL('image/png'));
      }
    };
    img.onerror = () => {
      // Fallback: use original URL directly
      setImageDataUrl(null);
    };
    img.src = personArchetype.imageUrl;
  }, [personArchetype.imageUrl]);

  const handleShare = useCallback(async () => {
    // If first-time free user, open paywall instead of sharing
    if (isFirstTimeFree) {
      onPaywallOpen?.();
      return;
    }

    if (!cardRef.current || isGenerating) return;
    setIsGenerating(true);

    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        backgroundColor: '#0a0a0a',
        skipFonts: true,
        imagePlaceholder: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'toxic-or-nah.png', { type: 'image/png' });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Toxic or Nah?',
          text: `${personArchetype.title} - ${getToxicityLabel(score)}`
        });
      } else {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'toxic-or-nah.png';
        link.click();
      }
    } catch (err) {
      console.error('Share failed:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, personArchetype.title, score]);

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Capturable area (logo + card) */}
      <div ref={cardRef} className="pb-4">
      {/* Logo */}
      <div className="flex items-center justify-center mb-5">
        <img
          src="/logo-full.png"
          alt="Toxic or Nah?"
          className="h-7 object-contain"
        />
      </div>

      {/* The Card */}
      <div
        className="rounded-[28px] overflow-hidden"
        style={{ background: gradientTo }}
      >
        {/* Person Archetype Image (square, edge-to-edge) */}
        <div
          className="w-full overflow-hidden"
          style={{ aspectRatio: '1/1' }}
        >
          <img
            src={imageDataUrl || personArchetype.imageUrl}
            alt={personArchetype.title}
            crossOrigin="anonymous"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Bottom Panel */}
        <div
          className="px-6 pt-7 pb-6 flex flex-col items-center text-center"
          style={{ background: `linear-gradient(to top left, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
        >
          {/* Archetype Title (HERO) */}
          <h3
            className="text-white"
            style={{ fontSize: '26px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', lineHeight: '1.3' }}
          >
            {personArchetype.title}
          </h3>

          {/* Snarky Tagline */}
          <p
            className="text-white/60 mt-2"
            style={{ fontSize: '15px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            {personArchetype.shareableTagline}
          </p>

          {/* Toxicity Badge - Score Ring + Label */}
          <div className="flex items-center justify-center gap-3 mt-4">
            <MiniScoreRing score={score} />
            <div className="flex flex-col items-start">
              <span
                className="text-white"
                style={{ fontSize: '18px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
              >
                {getToxicityLabel(score)}
              </span>
              <span
                className="text-white/40"
                style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                Toxicity Score
              </span>
            </div>
          </div>

          {/* User Quote (only if present) */}
          {userQuote && (
            <p
              className="mt-4 italic text-white/60"
              style={{
                fontSize: '15px',
                fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px'
              }}
            >
              "{userQuote}"
            </p>
          )}
        </div>
      </div>
      </div>{/* End capturable area */}

      {/* Quote Input (outside the card) */}
      <div className="mt-4 relative">
        <input
          type="text"
          value={userQuote}
          onChange={(e) => {
            if (e.target.value.length <= maxChars) {
              onQuoteChange(e.target.value);
            }
          }}
          placeholder={`What would you tell ${pronoun}?`}
          maxLength={maxChars}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-white/30 focus:outline-none focus:border-white/25"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        />
        <span
          className="absolute right-3 bottom-3 text-white/30"
          style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          {userQuote.length}/{maxChars}
        </span>
      </div>

      {/* Share Button */}
      <div className="mt-5">
        <button
          onClick={handleShare}
          disabled={isGenerating}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full active:scale-95 transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(to right, #7c3aed, #06b6d4)', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          {isFirstTimeFree ? (
            <Lock className="w-4 h-4 text-white" />
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-white"
            >
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          )}
          <span className="text-white font-medium" style={{ fontSize: '15px' }}>
            {isGenerating ? 'Generating...' : `Call ${pronoun === 'him' ? 'Him' : 'Her'} Out`}
          </span>
        </button>
      </div>

    </div>
  );
}
