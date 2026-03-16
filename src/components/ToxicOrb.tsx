"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;
const BLUR_MULTIPLIER_SMALL = 0.008;
const BLUR_MIN_SMALL = 1;
const BLUR_MULTIPLIER_LARGE = 0.015;
const BLUR_MIN_LARGE = 4;
const CONTRAST_MULTIPLIER_SMALL = 0.004;
const CONTRAST_MIN_SMALL = 1.2;
const CONTRAST_MULTIPLIER_LARGE = 0.008;
const CONTRAST_MIN_LARGE = 1.5;
const DOT_SIZE_MULTIPLIER_SMALL = 0.004;
const DOT_SIZE_MIN_SMALL = 0.05;
const DOT_SIZE_MULTIPLIER_LARGE = 0.008;
const DOT_SIZE_MIN_LARGE = 0.1;
const SHADOW_MULTIPLIER_SMALL = 0.004;
const SHADOW_MIN_SMALL = 0.5;
const SHADOW_MULTIPLIER_LARGE = 0.008;
const SHADOW_MIN_LARGE = 2;
const MASK_RADIUS_TINY = "0%";
const MASK_RADIUS_SMALL = "5%";
const MASK_RADIUS_MEDIUM = "15%";
const MASK_RADIUS_LARGE = "25%";
const CONTRAST_TINY = 1.1;
const CONTRAST_MULTIPLIER_FINAL = 1.2;
const CONTRAST_MIN_FINAL = 1.3;

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function getZoneColors(score: number) {
  const s = clamp(score);
  if (s <= 33) {
    // Safe zone - teal/cyan/green
    return {
      bg: "oklch(15% 0.02 180)",
      c1: "oklch(75% 0.18 170)", // Teal
      c2: "oklch(70% 0.15 145)", // Green-cyan
      c3: "oklch(72% 0.16 190)", // Cyan
      c4: "oklch(68% 0.14 160)", // Darker teal
      zone: "SAFE ZONE",
      zoneColor: "#6EE7B7",
      isToxic: false,
    };
  }
  if (s <= 66) {
    // Risky zone - amber/orange/yellow
    return {
      bg: "oklch(15% 0.02 60)",
      c1: "oklch(78% 0.18 70)", // Amber
      c2: "oklch(75% 0.20 45)", // Orange
      c3: "oklch(82% 0.15 90)", // Yellow
      c4: "oklch(70% 0.22 55)", // Deep orange
      zone: "RISKY ZONE",
      zoneColor: "#FCD34D",
      isToxic: false,
    };
  }
  // Toxic zone - 4 very different colors for max contrast
  return {
    bg: "oklch(8% 0.06 15)",
    c1: "oklch(40% 0.28 25)", // Dark blood red
    c2: "oklch(80% 0.20 65)", // Bright orange-gold
    c3: "oklch(60% 0.32 350)", // Hot magenta/pink
    c4: "oklch(72% 0.18 75)", // Darker golden yellow
    zone: "",
    zoneColor: "#EF4444",
    isToxic: true,
  };
}

// Loading state colors - neutral purple/violet
const LOADING_COLORS = {
  bg: "oklch(12% 0.03 280)",
  c1: "oklch(45% 0.15 280)", // Deep purple
  c2: "oklch(55% 0.18 290)", // Violet
  c3: "oklch(50% 0.12 270)", // Muted purple
  c4: "oklch(40% 0.10 285)", // Dark violet
};

export interface ToxicOrbProps {
  score: number;
  size?: number;
  className?: string;
  animationDuration?: number;
  isLoading?: boolean;
  fontSizeOverride?: number;
}

export function ToxicOrb({
  score,
  size = 260,
  className = "",
  animationDuration = 20,
  isLoading = false,
  fontSizeOverride,
}: ToxicOrbProps) {
  // Use loading colors when loading, otherwise use score-based colors
  const colors = isLoading ? LOADING_COLORS : getZoneColors(score);
  const sizeStr = `${size}px`;


  // Count-up animation
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));

  useEffect(() => {
    const controls = animate(mv, score, {
      duration: 0.85,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [score, mv]);

  // Ethereal energy intensity based on score
  const s = clamp(score);
  const flameIntensity = s > 66 ? 1.15 : s > 33 ? 1.1 : 1.05;

  // Extract numeric value from size for calculations
  const sizeValue = size;

  // Responsive calculations based on size
  const blurAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * BLUR_MULTIPLIER_SMALL, BLUR_MIN_SMALL)
      : Math.max(sizeValue * BLUR_MULTIPLIER_LARGE, BLUR_MIN_LARGE);

  const contrastAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * CONTRAST_MULTIPLIER_SMALL, CONTRAST_MIN_SMALL)
      : Math.max(sizeValue * CONTRAST_MULTIPLIER_LARGE, CONTRAST_MIN_LARGE);

  const dotSize =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * DOT_SIZE_MULTIPLIER_SMALL, DOT_SIZE_MIN_SMALL)
      : Math.max(sizeValue * DOT_SIZE_MULTIPLIER_LARGE, DOT_SIZE_MIN_LARGE);

  const shadowSpread =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * SHADOW_MULTIPLIER_SMALL, SHADOW_MIN_SMALL)
      : Math.max(sizeValue * SHADOW_MULTIPLIER_LARGE, SHADOW_MIN_LARGE);

  const getMaskRadius = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return MASK_RADIUS_TINY;
    if (value < SIZE_THRESHOLD_SMALL) return MASK_RADIUS_SMALL;
    if (value < SIZE_THRESHOLD_MEDIUM) return MASK_RADIUS_MEDIUM;
    return MASK_RADIUS_LARGE;
  };

  const maskRadius = getMaskRadius(sizeValue);

  const getFinalContrast = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return CONTRAST_TINY;
    if (value < SIZE_THRESHOLD_SMALL) {
      return Math.max(
        contrastAmount * CONTRAST_MULTIPLIER_FINAL,
        CONTRAST_MIN_FINAL
      );
    }
    return contrastAmount;
  };

  const finalContrast = getFinalContrast(sizeValue);

  return (
    <div className={`relative flex flex-col items-center ${className}`}>
      {/* Orb container */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: sizeStr, height: sizeStr, isolation: 'isolate', overflow: 'hidden', borderRadius: '50%' }}
      >
        {/* The Orb with fluid flame animation + glassmorphism entrance */}
        <motion.div
          className="toxic-orb"
          initial={{
            opacity: 0,
            scale: 0.8,
            filter: "blur(20px)"
          }}
          animate={{
            opacity: 1,
            scale: 1,
            filter: "blur(0px)"
          }}
          transition={{
            duration: 1.2,
            ease: [0.16, 1, 0.3, 1],
            delay: 0.2,
          }}
          style={
            {
              width: sizeStr,
              height: sizeStr,
              "--bg": colors.bg,
              "--c1": colors.c1,
              "--c2": colors.c2,
              "--c3": colors.c3,
              "--c4": colors.c4,
              "--animation-duration": `${animationDuration}s`,
              "--blur-amount": `${blurAmount}px`,
              "--contrast-amount": finalContrast,
              "--dot-size": `${dotSize}px`,
              "--shadow-spread": `${shadowSpread}px`,
              "--mask-radius": maskRadius,
              "--flame-intensity": flameIntensity,
            } as React.CSSProperties
          }
        />

        {/* Score text (centered on top of orb) - hidden when loading */}
        {!isLoading && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center z-10"
            initial={{
              opacity: 0,
              scale: 0.5,
              filter: "blur(15px)"
            }}
            animate={{
              opacity: 1,
              scale: 1,
              filter: "blur(0px)"
            }}
            transition={{
              duration: 1,
              ease: [0.16, 1, 0.3, 1],
              delay: 0.5,
            }}
          >
            <motion.div
              className="text-white leading-none"
              style={{
                fontSize: fontSizeOverride ? `${fontSizeOverride}px` : `${Math.max(size * 0.25, 9)}px`,
                fontFamily: "Plus Jakarta Sans, sans-serif",
                fontWeight: size < 60 ? 400 : 600,
                letterSpacing: "-0.02em",
                textShadow: size < 60 ? "0 1px 4px rgba(0,0,0,0.5)" : "0 2px 20px rgba(0,0,0,0.5)",
              }}
            >
              {rounded}
            </motion.div>
          </motion.div>
        )}

        {/* Loading pulse overlay */}
        {isLoading && (
          <motion.div
            className="absolute inset-0 z-10"
            animate={{
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{
              background: "radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 70%)",
              borderRadius: "50%",
            }}
          />
        )}

        {/* CSS for the orb */}
        <style>{`
          @property --angle {
            syntax: "<angle>";
            inherits: false;
            initial-value: 0deg;
          }

          .toxic-orb {
            display: grid;
            grid-template-areas: "stack";
            overflow: hidden;
            position: absolute;
            background: transparent;
            -webkit-backface-visibility: hidden;
            backface-visibility: hidden;
            will-change: transform, border-radius;
            animation: blob-morph 12s ease-in-out infinite;
          }

          @keyframes blob-morph {
            0%, 100% {
              border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
            }
            25% {
              border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%;
            }
            50% {
              border-radius: 50% 60% 30% 60% / 30% 40% 70% 50%;
            }
            75% {
              border-radius: 60% 40% 60% 40% / 70% 30% 50% 60%;
            }
          }

          .toxic-orb::before,
          .toxic-orb::after {
            content: "";
            display: block;
            grid-area: stack;
            width: 100%;
            height: 100%;
            border-radius: inherit;
          }

          .toxic-orb::before {
            background:
              conic-gradient(
                from calc(var(--angle) * 2) at 25% 70%,
                var(--c3),
                transparent 15% 85%,
                var(--c3)
              ),
              conic-gradient(
                from calc(var(--angle) * -1.5) at 50% 50%,
                var(--c4),
                transparent 10% 90%,
                var(--c4)
              ),
              conic-gradient(
                from calc(var(--angle) * 2) at 45% 75%,
                var(--c2),
                transparent 20% 70%,
                var(--c2)
              ),
              conic-gradient(
                from calc(var(--angle) * -3) at 80% 20%,
                var(--c1),
                transparent 25% 75%,
                var(--c1)
              ),
              conic-gradient(
                from calc(var(--angle) * 1.5) at 70% 60%,
                var(--c4),
                transparent 15% 85%,
                var(--c4)
              ),
              conic-gradient(
                from calc(var(--angle) * 2) at 15% 5%,
                var(--c2),
                transparent 10% 90%,
                var(--c2)
              ),
              conic-gradient(
                from calc(var(--angle) * 1) at 20% 80%,
                var(--c1),
                transparent 10% 90%,
                var(--c1)
              ),
              conic-gradient(
                from calc(var(--angle) * -2) at 85% 10%,
                var(--c3),
                transparent 15% 85%,
                var(--c3)
              ),
              conic-gradient(
                from calc(var(--angle) * 2.5) at 30% 30%,
                var(--c4),
                transparent 20% 80%,
                var(--c4)
              );
            filter: blur(var(--blur-amount)) contrast(var(--contrast-amount));
            animation: toxic-rotate var(--animation-duration) linear infinite;
          }

          @keyframes toxic-rotate {
            to {
              --angle: 360deg;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .toxic-orb::before {
              animation: none;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
