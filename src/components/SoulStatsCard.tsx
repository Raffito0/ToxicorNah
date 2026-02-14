import { useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Share2 } from 'lucide-react';
import { haptics } from '../utils/haptics';

interface SoulStatsCardProps {
  stats: {
    totalAnalyses: number;
    totalRedFlags: number;
    totalRelationships: number;
    rarestPattern: {
      name: string;
      percentage: number;
    };
  };
  archetype: {
    title: string;
    tagline: string;
    gradientFrom: string;
    gradientTo: string;
  };
}

export function SoulStatsCard({ stats, archetype }: SoulStatsCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const generateShareImage = useCallback(async () => {
    haptics.medium();

    // Create canvas for Stories format (1080x1920)
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 1080;
    canvas.height = 1920;

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, archetype.gradientFrom);
    gradient.addColorStop(1, archetype.gradientTo);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add subtle noise texture effect
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    for (let i = 0; i < 5000; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      ctx.fillRect(x, y, 1, 1);
    }

    // Title: "YOUR SOUL IN NUMBERS"
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '600 36px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('YOUR SOUL IN NUMBERS', canvas.width / 2, 300);

    // Stats row
    const statsY = 500;
    const statsSpacing = 280;
    const statsStartX = canvas.width / 2 - statsSpacing;

    const statsData = [
      { value: stats.totalAnalyses.toString(), label: 'Analyses' },
      { value: stats.totalRedFlags.toString(), label: 'Red Flags' },
      { value: stats.totalRelationships.toString(), label: 'Guys' },
    ];

    statsData.forEach((stat, i) => {
      const x = statsStartX + (i * statsSpacing);

      // Value
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 72px "Satoshi", "Plus Jakarta Sans", sans-serif';
      ctx.fillText(stat.value, x, statsY);

      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '500 28px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(stat.label, x, statsY + 50);
    });

    // Divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.2, 680);
    ctx.lineTo(canvas.width * 0.8, 680);
    ctx.stroke();

    // Archetype Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 64px "Satoshi", "Plus Jakarta Sans", sans-serif';
    ctx.fillText(archetype.title.toUpperCase(), canvas.width / 2, 820);

    // Tagline
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = 'italic 32px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`"${archetype.tagline}"`, canvas.width / 2, 890);

    // Another divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.2, 1000);
    ctx.lineTo(canvas.width * 0.8, 1000);
    ctx.stroke();

    // Rarest Pattern section
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '500 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Your rarest pattern:', canvas.width / 2, 1120);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 48px "Satoshi", "Plus Jakarta Sans", sans-serif';
    ctx.fillText(stats.rarestPattern.name.toUpperCase(), canvas.width / 2, 1190);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '500 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`Only ${stats.rarestPattern.percentage}% of users have this`, canvas.width / 2, 1250);

    // App branding at bottom
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '600 32px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('toxic or nah', canvas.width / 2, 1700);

    // Convert to blob and share
    canvas.toBlob(async (blob) => {
      if (!blob) return;

      const file = new File([blob], 'my-soul-stats.png', { type: 'image/png' });

      // Try native share if available
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'My Soul Stats',
            text: 'Check out my relationship patterns',
          });
          haptics.success();
        } catch (err) {
          // User cancelled or error
          console.log('Share cancelled');
        }
      } else {
        // Fallback: download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'my-soul-stats.png';
        a.click();
        URL.revokeObjectURL(url);
        haptics.success();
      }
    }, 'image/png');
  }, [stats, archetype]);

  return (
    <div className="w-full">
      {/* Section Header */}
      <h2
        className="text-white/50 text-sm font-semibold mb-4 px-1"
        style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', letterSpacing: '0.05em' }}
      >
        SOUL STATS
      </h2>

      {/* Card Preview */}
      <motion.div
        ref={cardRef}
        className="relative w-full rounded-[24px] overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${archetype.gradientFrom}, ${archetype.gradientTo})`,
          aspectRatio: '1/1.2',
        }}
        whileTap={{ scale: 0.98 }}
      >
        {/* Content */}
        <div className="absolute inset-0 p-6 flex flex-col">
          {/* Title */}
          <p
            className="text-white/50 text-center mb-6"
            style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', letterSpacing: '0.1em' }}
          >
            YOUR SOUL IN NUMBERS
          </p>

          {/* Stats Row */}
          <div className="flex justify-around mb-6">
            <StatItem value={stats.totalAnalyses} label="Analyses" />
            <StatItem value={stats.totalRedFlags} label="Red Flags" />
            <StatItem value={stats.totalRelationships} label="Guys" />
          </div>

          {/* Divider */}
          <div className="h-px bg-white/10 mx-4 mb-6" />

          {/* Archetype */}
          <div className="text-center flex-1 flex flex-col justify-center">
            <h3
              className="text-white font-black mb-2"
              style={{ fontSize: '24px', fontFamily: 'Satoshi, sans-serif' }}
            >
              {archetype.title.toUpperCase()}
            </h3>
            <p
              className="text-white/60 italic mb-4"
              style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              "{archetype.tagline}"
            </p>

            {/* Divider */}
            <div className="h-px bg-white/10 mx-8 mb-4" />

            {/* Rarest Pattern */}
            <p
              className="text-white/40 mb-1"
              style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Your rarest pattern:
            </p>
            <p
              className="text-white font-bold mb-1"
              style={{ fontSize: '16px', fontFamily: 'Satoshi, sans-serif' }}
            >
              {stats.rarestPattern.name.toUpperCase()}
            </p>
            <p
              className="text-white/40"
              style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Only {stats.rarestPattern.percentage}% of users have this
            </p>
          </div>

          {/* App branding */}
          <p
            className="text-center text-white/20 mt-auto"
            style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            toxic or nah
          </p>
        </div>
      </motion.div>

      {/* Share Button */}
      <motion.button
        onClick={generateShareImage}
        className="w-full mt-4 py-3 px-6 rounded-full flex items-center justify-center gap-2"
        style={{
          background: 'rgba(255, 255, 255, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
        whileTap={{ scale: 0.98 }}
      >
        <Share2 size={18} className="text-white/70" />
        <span
          className="text-white/70 font-medium"
          style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          Share Your Soul
        </span>
      </motion.button>
    </div>
  );
}

function StatItem({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <p
        className="text-white font-black"
        style={{ fontSize: '28px', fontFamily: 'Satoshi, sans-serif' }}
      >
        {value}
      </p>
      <p
        className="text-white/50"
        style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
      >
        {label}
      </p>
    </div>
  );
}
