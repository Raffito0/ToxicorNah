import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SoulTypeMedia } from './SoulTypeMedia';
import { haptics } from '../utils/haptics';

interface SoulHeroProps {
  patternShock: {
    stat: string;
    label: string;
    insight: string;
    percentage: number;
  };
  archetype: {
    title: string;
    tagline: string;
    imageUrl: string;
    gradientFrom: string;
    gradientTo: string;
  };
}

export function SoulHero({ patternShock, archetype }: SoulHeroProps) {
  const [phase, setPhase] = useState<'shock' | 'reveal'>('shock');
  const [hasAnimatedShock, setHasAnimatedShock] = useState(false);

  // Auto-transition after shock animation completes
  useEffect(() => {
    if (phase === 'shock' && !hasAnimatedShock) {
      const timer = setTimeout(() => {
        setHasAnimatedShock(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [phase, hasAnimatedShock]);

  const handleTap = () => {
    if (phase === 'shock') {
      haptics.medium();
      setPhase('reveal');
    }
  };

  return (
    <div className="relative w-full" style={{ minHeight: '500px' }}>
      <AnimatePresence mode="wait">
        {phase === 'shock' ? (
          <motion.div
            key="shock"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 flex flex-col items-center justify-center px-8 cursor-pointer"
            style={{ background: '#0a0a0a', minHeight: '500px' }}
            onClick={handleTap}
          >
            {/* The Stat - Huge Number */}
            <motion.div
              className="text-center mb-6"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5, ease: 'easeOut' }}
            >
              <div
                className="text-white font-black mb-2"
                style={{
                  fontSize: '64px',
                  fontFamily: 'Satoshi, sans-serif',
                  lineHeight: 1,
                }}
              >
                {patternShock.stat}
              </div>
              <div
                className="text-white/50"
                style={{
                  fontSize: '16px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                  textTransform: 'lowercase',
                }}
              >
                {patternShock.label}
              </div>
            </motion.div>

            {/* The Insight */}
            <motion.p
              className="text-center text-white/70 max-w-[280px]"
              style={{
                fontSize: '20px',
                fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                lineHeight: 1.4,
              }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.5 }}
            >
              {patternShock.insight}
            </motion.p>

            {/* The Percentage Bar */}
            <motion.div
              className="w-full max-w-[240px] mt-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.3 }}
            >
              <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: '#ef4444' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${patternShock.percentage}%` }}
                  transition={{ delay: 1.4, duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <motion.p
                className="text-center text-white/30 mt-2"
                style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.8, duration: 0.3 }}
              >
                Energy imbalance detected
              </motion.p>
            </motion.div>

            {/* Tap hint */}
            <motion.p
              className="absolute bottom-8 text-white/20"
              style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: hasAnimatedShock ? 1 : 0 }}
              transition={{ duration: 0.3 }}
            >
              Tap to reveal why
            </motion.p>
          </motion.div>
        ) : (
          <motion.div
            key="reveal"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="relative w-full overflow-hidden rounded-[28px]"
            style={{ aspectRatio: '9/16', maxHeight: '600px' }}
          >
            {/* Background Image */}
            {archetype.imageUrl ? (
              <SoulTypeMedia
                src={archetype.imageUrl}
                alt={archetype.title}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(135deg, ${archetype.gradientFrom}, ${archetype.gradientTo})`,
                }}
              />
            )}

            {/* Gradient Overlay */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to bottom, transparent 20%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.95) 100%)',
              }}
            />

            {/* Content at Bottom */}
            <div className="absolute bottom-0 left-0 right-0 p-6 text-center">
              {/* Archetype Title */}
              <motion.h1
                className="text-white font-black mb-3"
                style={{
                  fontSize: '32px',
                  fontFamily: 'Satoshi, sans-serif',
                  letterSpacing: '-0.02em',
                }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
              >
                {archetype.title.toUpperCase()}
              </motion.h1>

              {/* Tagline */}
              <motion.p
                className="text-white/70 mb-4"
                style={{
                  fontSize: '16px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                  fontStyle: 'italic',
                }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
              >
                "{archetype.tagline}"
              </motion.p>

              {/* "This is why" link */}
              <motion.p
                className="text-white/40"
                style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.5 }}
              >
                This is why.
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
