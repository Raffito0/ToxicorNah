import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { haptics } from '../utils/haptics';
import { useRef, useState } from 'react';

// Ensure accent color is dark enough for white text to be readable
// If too light, darken it automatically
function ensureDarkEnoughForWhiteText(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate relative luminance using sRGB formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // If luminance is above 0.45, the color is too light for white text
  // Darken it by multiplying RGB values
  if (luminance > 0.45) {
    // Calculate how much to darken (more darkening for lighter colors)
    const darkenFactor = 0.45 / luminance;
    const newR = Math.round(r * darkenFactor);
    const newG = Math.round(g * darkenFactor);
    const newB = Math.round(b * darkenFactor);

    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  }

  return hexColor;
}

interface MessageInsightCardProps {
  message: string;
  messageCount: string;
  title: string;
  tag: string;
  tagColor: string;
  description: string;
  solution: string;
  gradientStart: string;
  gradientEnd: string;
  accentColor: string;
  isTop: boolean;
  isFlipped: boolean;
  visualIndex: number;
  distanceFromTop: number;
  cardIndex?: number;
  isFirstTimeFree?: boolean;
  onTap: () => void;
  onSwipe: () => void;
  onPaywallOpen?: () => void;
  hasDealt?: boolean;
  dealDelay?: number;
}

// Default gradient colors based on tag type (3 tags: RED FLAG, GREEN FLAG, DECODED)
function getDefaultGradient(tag: string): { start: string; end: string; accent: string } {
  const tagUpper = (tag || '').toUpperCase();
  switch (tagUpper) {
    case 'GREEN FLAG':
      return { start: '#1A3D2E', end: '#0D2619', accent: '#9ddf90' };
    case 'DECODED':
      return { start: '#2A1A4E', end: '#1A0F33', accent: '#B39DDB' };
    case 'RED FLAG':
    default:
      return { start: '#5C1A1A', end: '#3D1212', accent: '#ff9d9d' };
  }
}

export function MessageInsightCard({
  message,
  messageCount,
  title,
  tag,
  tagColor,
  description,
  solution,
  gradientStart: gradientStartProp,
  gradientEnd: gradientEndProp,
  accentColor: accentColorProp,
  isTop,
  isFlipped,
  visualIndex,
  distanceFromTop,
  cardIndex = 0,
  isFirstTimeFree = false,
  onTap,
  onSwipe,
  onPaywallOpen,
  hasDealt = true,
  dealDelay = 0,
}: MessageInsightCardProps) {
  const defaults = getDefaultGradient(tag);
  const gradientStart = gradientStartProp || defaults.start;
  const gradientEnd = gradientEndProp || defaults.end;
  // Force accent color based on tag type - always use our defined colors
  const accentColor = defaults.accent;
  const translateY = visualIndex * 20;

  // Track drag state to distinguish taps from drags
  const isDraggingRef = useRef(false);
  const dragDistanceRef = useRef(0);
  const scale = 1 - (distanceFromTop * 0.02);

  // Lock states for first-time free users:
  // - Card 0 front: UNLOCKED
  // - Card 0 solution (flip): UNLOCKED (first one free)
  // - Cards 1+ front: LOCKED (blurred)
  // - Cards 1+ solution: LOCKED
  const isCardLocked = isFirstTimeFree && cardIndex > 0;
  const isSolutionLocked = isFirstTimeFree && cardIndex > 0;

  // Handle tap: always flip the card (paywall is triggered by tapping the pill itself)
  const handleTap = () => {
    // Don't handle tap if we just finished dragging
    if (isDraggingRef.current || dragDistanceRef.current > 10) {
      return;
    }
    if (!isTop) return;
    haptics.medium();
    onTap();
  };

  // Dynamic line clamp: title + description = 6 lines total
  // Title is NEVER truncated - it must display completely
  // Description gets remaining lines: 5 if title is 1 line, 4 if title is 2 lines
  // Title is considered 2 lines if longer than 18 characters
  const titleIsLong = title.length > 18;
  const descriptionLineClamp = titleIsLong ? 4 : 5;

  return (
    // Outer div: handles stack positioning only (no drag)
    <motion.div
      className="absolute left-0 right-0"
      style={{
        zIndex: visualIndex,
        height: '220px',
        top: 0,
      }}
      initial={false}
      animate={hasDealt ? {
        y: translateY,
        scale: scale,
        opacity: 1,
        filter: 'blur(0px)',
      } : {
        y: 0,
        scale: 0.92,
        opacity: 0,
        filter: 'blur(10px)',
      }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 30,
        delay: hasDealt ? dealDelay : 0,
      }}
      layout={false}
    >
      {/* Inner div: handles drag only (separate from stack position) */}
      <motion.div
        className={`w-full h-full ${isTop ? 'cursor-pointer' : ''}`}
        drag={isTop ? "y" : false}
        dragConstraints={{ top: -80, bottom: 80 }}
        dragElastic={0.6}
        dragMomentum={false}
        dragSnapToOrigin={true}
        onTap={handleTap}
        onDragStart={() => {
          isDraggingRef.current = true;
          dragDistanceRef.current = 0;
        }}
        onDrag={(e, { offset }) => {
          dragDistanceRef.current = Math.abs(offset.y);
        }}
        onDragEnd={(e, { offset, velocity }) => {
          const swipeThreshold = 60;
          const swipeVelocityThreshold = 300;

          if (Math.abs(offset.y) > swipeThreshold || Math.abs(velocity.y) > swipeVelocityThreshold) {
            haptics.swipe();
            onSwipe();
          }

          // Reset drag state after a short delay to allow tap check
          setTimeout(() => {
            isDraggingRef.current = false;
            dragDistanceRef.current = 0;
          }, 50);
        }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 30,
        }}
      >
        <div style={{ perspective: '1000px', WebkitPerspective: '1000px', height: '100%', width: '100%', transform: 'translate3d(0,0,0)', transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d' } as React.CSSProperties}>
        <motion.div
          className="relative w-full h-full"
          style={{
            transformStyle: 'preserve-3d',
            WebkitTransformStyle: 'preserve-3d',
            borderRadius: '28px',
            transformOrigin: 'center center',
          }}
          initial={false}
          animate={{
            rotateY: isFlipped ? [0, 0, 180, 180] : 0,
            y: isFlipped ? [0, -40, -40, 0] : 0,
          }}
          transition={
            isFlipped
              ? {
                  duration: 0.5,
                  times: [0, 0.25, 0.75, 1],
                  ease: [0.4, 0, 0.2, 1],
                }
              : {
                  duration: 0.4,
                  ease: "easeInOut",
                }
          }
          layout={false}
        >
          {/* Dim overlay for non-top cards */}
          {!isTop && (
            <div className="absolute inset-0 bg-black/30 z-20" style={{ borderRadius: '28px' }}></div>
          )}

          <div
            className="absolute inset-0 h-full flex"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'translateZ(1px)',
              WebkitTransform: 'translateZ(1px)',
              borderRadius: '28px',
              overflow: 'hidden',
              background: '#111111',
            }}
          >
            {/* Background image - different for each tag type */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: tag.toUpperCase() === 'GREEN FLAG'
                  ? 'url(/Screenshot%202026-02-01%20111831%202.png)'
                  : tag.toUpperCase() === 'DECODED'
                    ? 'url(/Screenshot%202026-02-01%20111831%282%29%201.png)'
                    : 'url(/Screenshot%202026-02-01%20111831%201.png)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                zIndex: 0,
              }}
            />
            {/* Black overlay 25% */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                zIndex: 1,
              }}
            />
            {/* Gradient overlay at the bottom */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '70%',
                background: 'linear-gradient(to top, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.4) 40%, transparent 100%)',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />
            <div className="w-1/2 h-full flex items-center justify-center p-4 relative z-10" style={{ borderRadius: '28px 0 0 28px' }}>
              <div className="px-3.5 py-2.5 rounded-[16px] w-full max-w-[130px]" style={{
                position: 'relative',
                transform: 'rotate(-6deg)',
                background: tag.toUpperCase() === 'DECODED'
                  ? 'rgba(124, 77, 255, 0.12)'
                  : 'rgba(255, 255, 255, 0.04)',
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                color: '#ffffff',
              }}>
                <p style={{
                  fontSize: '12px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontWeight: 200,
                  letterSpacing: '1.5px',
                  color: '#FFFFFF',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical' as const,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {message}
                </p>
              </div>
            </div>

            <div className="w-1/2 h-full flex flex-col items-start justify-center px-4 py-3 relative z-10">
              <div className="inline-flex items-center gap-1.5 mb-2" style={{
                color: accentColor
              }}>
                {/* Tag-specific icons */}
                {tag.toUpperCase() === 'GREEN FLAG' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 2v20h2v-8h14l-4-6 4-6H4z" />
                  </svg>
                ) : tag.toUpperCase() === 'DECODED' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z" />
                  </svg>
                )}
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{tag}</span>
              </div>

              <h3 className="text-white mb-2" style={{
                fontSize: '17px',
                fontWeight: 500,
                letterSpacing: '1.5px',
                lineHeight: '1.2',
                fontFamily: 'Outfit, sans-serif',
              }}>
                {title}
              </h3>

              <div className="relative">
                <p style={{
                  fontSize: '12px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontWeight: 200,
                  letterSpacing: '1.5px',
                  color: 'rgba(255, 255, 255, 0.7)',
                  overflow: 'hidden',
                  ...(isCardLocked ? { filter: 'blur(5px)', userSelect: 'none' as const } : {}),
                }}>
                  {description}
                </p>
                {isCardLocked && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ padding: '12px', cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => { e.stopPropagation(); onPaywallOpen?.(); }}
                  >
                    <div
                      className="flex items-center gap-2 px-4 py-3 rounded-full"
                      style={{
                        background: '#7200B4',
                      }}
                    >
                      <Lock className="w-4 h-4 text-white" />
                      <span className="text-white font-medium uppercase" style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px' }}>
                        Reveal
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="absolute bottom-3 right-5 text-white/50" style={{ fontSize: '11px', fontWeight: 500 }}>
                {messageCount}
              </div>
            </div>
          </div>

          <div
            className="absolute inset-0 h-full"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg) translateZ(2px)',
              WebkitTransform: 'rotateY(180deg) translateZ(2px)',
              borderRadius: '28px',
              overflow: 'hidden',
              backgroundColor: '#111111',
            }}
          >
            {/* Background image - same as front side, mirrored */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: tag.toUpperCase() === 'GREEN FLAG'
                  ? 'url(/Screenshot%202026-02-01%20111831%202.png)'
                  : tag.toUpperCase() === 'DECODED'
                    ? 'url(/Screenshot%202026-02-01%20111831%282%29%201.png)'
                    : 'url(/Screenshot%202026-02-01%20111831%201.png)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                transform: 'scaleX(-1)',
                zIndex: 0,
              }}
            />

            {/* Glassmorphism overlay */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                zIndex: 1,
              }}
            />

            {/* Black overlay 50% */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 2,
              }}
            />

            {/* Content */}
            <div className="absolute inset-0 flex items-center justify-center p-6" style={{ zIndex: 3 }}>
              <motion.div
                className="text-center"
                initial={{ opacity: 0, filter: 'blur(8px)' }}
                animate={{
                  opacity: isFlipped ? 1 : 0,
                  filter: isFlipped ? 'blur(0px)' : 'blur(8px)'
                }}
                transition={{ duration: 0.3, delay: isFlipped ? 0.4 : 0 }}
              >
                <div className="mb-2">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full" style={{ backgroundColor: 'rgba(255, 255, 255, 0.10)' }}>
                    {tag.toUpperCase() === 'DECODED' ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                  </div>
                </div>
                <h4 className="text-white mb-2" style={{ fontSize: '14px', fontWeight: 500, fontFamily: 'Outfit, sans-serif', letterSpacing: '1.5px' }}>
                  What It Really Means
                </h4>
                <div className="relative">
                  <p style={{
                    fontSize: '12px',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontWeight: 200,
                    letterSpacing: '1.5px',
                    color: 'rgba(255, 255, 255, 0.7)',
                    ...(isSolutionLocked ? { filter: 'blur(5px)', userSelect: 'none' as const } : {}),
                  }}>
                    {solution}
                  </p>
                  {isSolutionLocked && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ padding: '12px', cursor: 'pointer' }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => { e.stopPropagation(); onPaywallOpen?.(); }}
                    >
                      <div
                        className="flex items-center gap-2 px-4 py-3 rounded-full"
                        style={{
                          background: '#7200B4',
                        }}
                      >
                        <Lock className="w-4 h-4 text-white" />
                        <span className="text-white font-medium uppercase" style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px' }}>
                          Reveal
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>
      </motion.div>
    </motion.div>
  );
}
