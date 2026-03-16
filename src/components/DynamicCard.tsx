import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { SkeletonCard } from './SkeletonCard';

interface DynamicCardProps {
  dynamicName: string;
  subtitle: string;
  whyThisHappens: string;
  patternBreak: string;
  powerBalance: number;
  gradientStart?: string;
  gradientEnd?: string;
  personName: string;
  personArchetype: {
    name: string;
    title: string;
    imageUrl: string;
    sideProfileImageUrl?: string;
  };
  userArchetype: {
    name: string;
    title: string;
    imageUrl: string;
    sideProfileImageUrl?: string;
  };
  isFirstTimeFree?: boolean;
  onPaywallOpen?: () => void;
  isLoading?: boolean;
}

export function DynamicCard({
  dynamicName,
  subtitle,
  whyThisHappens,
  patternBreak,
  powerBalance: _powerBalance,
  gradientStart = '#1a1a2e',
  gradientEnd = '#0f0f1a',
  personName: _personName,
  personArchetype,
  userArchetype,
  isFirstTimeFree = false,
  onPaywallOpen,
  isLoading = false
}: DynamicCardProps) {
  // Unused props prefixed with _ to avoid warnings
  void _powerBalance;
  void _personName;

  const [isFlipped, setIsFlipped] = useState(false);

  // Back side is locked for first-time free users
  const isBackSideLocked = isFirstTimeFree;

  const handleClick = () => {
    // Always flip — paywall is triggered by tapping the pill itself
    setIsFlipped(!isFlipped);
  };

  // Show skeleton when loading
  if (isLoading) {
    return (
      <div className="w-full relative">
        <SkeletonCard aspectRatio="9/16" rounded="28px" />

        {/* Loading hint */}
        <div className="flex justify-center mt-4">
          <motion.p
            className="text-white/50 uppercase"
            style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            Revealing the dynamic...
          </motion.p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full relative">
      <div
        className="relative w-full cursor-pointer"
        style={{
          perspective: '1000px',
          WebkitPerspective: '1000px',
          aspectRatio: '9/16',
          transform: 'translate3d(0,0,0)',
          WebkitTransform: 'translate3d(0,0,0)',
        }}
        onClick={handleClick}
      >
        <motion.div
          className="relative w-full h-full"
          style={{ transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d' } as React.CSSProperties}
          initial={false}
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* FRONT SIDE - Like His Soul Type card */}
          <div
            className="absolute inset-0 rounded-[28px] overflow-hidden"
            style={{
              backgroundColor: '#111111',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            } as React.CSSProperties}
          >
            {/* Side profile images - male left, female right, overlapping with blend */}
            <img
              src={personArchetype.sideProfileImageUrl || personArchetype.imageUrl}
              alt={personArchetype.title}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ objectPosition: 'left center' }}
            />
            <img
              src={userArchetype.sideProfileImageUrl || userArchetype.imageUrl}
              alt={userArchetype.title}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ objectPosition: 'right center', mixBlendMode: 'lighten' }}
            />

            {/* Noise/Grain overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                opacity: 0.06,
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                mixBlendMode: 'overlay',
              }}
            />

            {/* Glassmorphism layer - extended outside card bounds to cover edge glitches */}
            <div
              style={{
                position: 'absolute',
                bottom: '-2px',
                left: '-2px',
                right: '-2px',
                height: 'calc(50% + 2px)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 50%, black 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 50%, black 100%)',
              }}
            />
            {/* Dark gradient overlay - extended to match */}
            <div
              style={{
                position: 'absolute',
                bottom: '-2px',
                left: '-2px',
                right: '-2px',
                height: 'calc(45% + 2px)',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0.85) 100%)',
              }}
            />

            {/* Content layer */}
            <div
              className="absolute bottom-0 left-0 right-0 px-6 pb-[40px] flex flex-col items-center text-center"
            >
              {/* Dynamic Title */}
              <h3
                style={{ fontSize: '32px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', lineHeight: '1.3', color: '#FFFFFF' }}
              >
                {dynamicName}
              </h3>

              {/* Subtitle */}
              <p
                className="mt-2 max-w-[280px]"
                style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.7)' }}
              >
                {subtitle}
              </p>

              {/* Soul Type Blocks */}
              <div className="flex items-center mt-6">
                {/* His Soul Type */}
                <div
                  className="flex flex-col items-center justify-center"
                  style={{
                    width: '140px',
                    textAlign: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 200,
                      letterSpacing: '1.5px',
                      color: 'rgba(255, 255, 255, 0.6)',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    His Soul Type
                  </span>
                  <span
                    style={{
                      fontSize: '16px',
                      fontFamily: 'Outfit, sans-serif',
                      fontWeight: 400,
                      letterSpacing: '1.5px',
                      color: '#FFFFFF',
                      marginTop: '4px',
                    }}
                  >
                    {personArchetype.title}
                  </span>
                </div>

                {/* Vertical Divider */}
                <div
                  style={{
                    width: '1px',
                    height: '40px',
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    margin: '0 12px',
                  }}
                />

                {/* Your Soul Type */}
                <div
                  className="flex flex-col items-center justify-center"
                  style={{
                    width: '140px',
                    textAlign: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 200,
                      letterSpacing: '1.5px',
                      color: 'rgba(255, 255, 255, 0.6)',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Your Soul Type
                  </span>
                  <span
                    style={{
                      fontSize: '16px',
                      fontFamily: 'Outfit, sans-serif',
                      fontWeight: 400,
                      letterSpacing: '1.5px',
                      color: '#FFFFFF',
                      marginTop: '4px',
                    }}
                  >
                    {userArchetype.title}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* BACK SIDE */}
          <div
            className="absolute inset-0 rounded-[28px] overflow-hidden flex flex-col justify-center"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              WebkitTransform: 'rotateY(180deg)',
              backgroundColor: '#111111',
            } as React.CSSProperties}
          >
            {/* Blurred background images container */}
            <div
              className="absolute inset-0"
              style={{ filter: 'blur(35px)', transform: 'scale(1.2)' }}
            >
              <img
                src={personArchetype.sideProfileImageUrl || personArchetype.imageUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                style={{ objectPosition: 'left center' }}
              />
              <img
                src={userArchetype.sideProfileImageUrl || userArchetype.imageUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                style={{ objectPosition: 'right center', mixBlendMode: 'lighten' }}
              />
            </div>

            {/* Dark overlay */}
            <div
              className="absolute inset-0"
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
            />

            {/* Subtle gradient for depth */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.25) 100%)',
                zIndex: 1,
              }}
            />

            <motion.div
              className="flex flex-col justify-center h-full relative z-10"
              initial={{ opacity: 0, filter: 'blur(8px)' }}
              animate={{
                opacity: isFlipped ? 1 : 0,
                filter: isFlipped ? 'blur(0px)' : 'blur(8px)'
              }}
              transition={{ duration: 0.3, delay: isFlipped ? 0.4 : 0 }}
            >
              {/* Why This Happens Section */}
              <div className="px-8 flex flex-col items-center text-center">
                <img
                  src="/icon-why.png"
                  alt=""
                  width="28"
                  height="28"
                  className="mb-4 opacity-40"
                />
                <h3
                  className="text-white mb-3"
                  style={{ fontSize: '18px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
                >
                  Why This Happens
                </h3>
                <div className="relative w-full">
                  <p
                    className="text-white/70"
                    style={{
                      fontSize: '14px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 200,
                      letterSpacing: '1.5px',
                      ...(isBackSideLocked ? { filter: 'blur(6px)', userSelect: 'none' as const } : {}),
                    }}
                  >
                    {whyThisHappens}
                  </p>
                  {isBackSideLocked && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ padding: '12px', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); onPaywallOpen?.(); }}
                    >
                      <div
                        className="flex items-center gap-2 px-4 py-3 rounded-full"
                        style={{
                          background: '#7200B4',
                        }}
                      >
                        <Lock className="w-4 h-4 text-white" />
                        <span className="text-white font-medium uppercase" style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px' }}>
                          See the full truth
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="mx-8 my-8">
                <div className="w-full h-px bg-white/10" />
              </div>

              {/* Your Next Move Section */}
              <div className="px-8 flex flex-col items-center text-center">
                <img
                  src="/your-next-move.png"
                  alt=""
                  width="28"
                  height="28"
                  className="mb-4 opacity-40"
                />
                <h3
                  className="text-white mb-3"
                  style={{ fontSize: '18px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
                >
                  Your Next Move
                </h3>
                <div className="relative w-full">
                  <p
                    className="text-white/70"
                    style={{
                      fontSize: '14px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 200,
                      letterSpacing: '1.5px',
                      ...(isBackSideLocked ? { filter: 'blur(6px)', userSelect: 'none' as const } : {}),
                    }}
                  >
                    {patternBreak}
                  </p>
                  {isBackSideLocked && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ padding: '12px', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); onPaywallOpen?.(); }}
                    >
                      <div
                        className="flex items-center gap-2 px-4 py-3 rounded-full"
                        style={{
                          background: '#7200B4',
                        }}
                      >
                        <Lock className="w-4 h-4 text-white" />
                        <span className="text-white font-medium uppercase" style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px' }}>
                          See the full truth
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* Tap hint */}
      <div className="flex justify-center mt-4">
        <motion.p
          className="text-white/50 uppercase flex items-center gap-2"
          style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <img src="/hand.png" alt="" className="w-4 h-4 opacity-70" />
          <span>Tap to {isFlipped ? (isBackSideLocked ? 'unlock' : 'flip back') : 'reveal more'}</span>
        </motion.p>
      </div>
    </div>
  );
}
