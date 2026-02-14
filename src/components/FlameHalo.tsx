import { useEffect, useMemo, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

type FlameHaloProps = {
  score: number;           // 0–100
  size?: number;           // px
  className?: string;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function palette(score: number) {
  const s = clamp(score);
  if (s <= 33) return {
    a: "#00FFD1",
    b: "#00B4FF",
    c: "#0B1220",
    zone: "SAFE ZONE",
    zoneColor: "#6EE7B7"
  };
  if (s <= 66) return {
    a: "#FFC35A",
    b: "#FF6A3D",
    c: "#120B0B",
    zone: "RISKY ZONE",
    zoneColor: "#FCD34D"
  };
  // toxic
  return {
    a: "#FF47C8",
    b: "#7A5CFF",
    c: "#2A0018",
    zone: "TOXIC ZONE",
    zoneColor: "#F472B6"
  };
}

export function FlameHalo({ score, size = 220, className }: FlameHaloProps) {
  const id = useMemo(() => `halo-${Math.random().toString(16).slice(2)}`, []);
  const pal = palette(score);

  // "Wildness" scales with score (more toxic = more distortion)
  const s = clamp(score);
  const baseFreq = s > 66 ? 0.012 : s > 33 ? 0.010 : 0.008;
  const scale = s > 66 ? 18 : s > 33 ? 14 : 10; // displacement strength

  // Animate turbulence via state (simple RAF) — smooth & controllable
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    let raf = 0;
    let t = 0;
    const tick = () => {
      t += 0.9; // speed (raise to make more alive)
      setSeed(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Count-up animation for score
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));

  useEffect(() => {
    const controls = animate(mv, score, {
      duration: 0.85,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [score, mv]);

  return (
    <div className={`relative flex flex-col items-center ${className ?? ""}`}>
      {/* Halo container */}
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        {/* SVG Flame Ring */}
        <svg width={size} height={size} viewBox="0 0 200 200" className="absolute overflow-visible">
          <defs>
            {/* Liquid "flame" distortion */}
            <filter id={`${id}-liquid`} x="-40%" y="-40%" width="180%" height="180%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency={baseFreq}
                numOctaves={2}
                seed={Math.floor(seed)}
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={scale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
              {/* soft bloom */}
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Glow */}
            <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feColorMatrix
                in="b"
                type="matrix"
                values="
                  1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 0.9 0"
                result="c"
              />
              <feMerge>
                <feMergeNode in="c" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Gradient stroke along ring */}
            <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={pal.a} stopOpacity="0.95" />
              <stop offset="55%" stopColor={pal.b} stopOpacity="0.85" />
              <stop offset="100%" stopColor={pal.a} stopOpacity="0.35" />
            </linearGradient>

            {/* Fine grain overlay */}
            <filter id={`${id}-grain`}>
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" />
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                <feFuncA type="table" tableValues="0 0.12" />
              </feComponentTransfer>
            </filter>
          </defs>

          {/* OUTER AURA haze */}
          <circle
            cx="100"
            cy="100"
            r="56"
            fill="none"
            stroke={pal.b}
            strokeOpacity="0.10"
            strokeWidth="30"
            filter={`url(#${id}-glow)`}
          />

          {/* FLAME RING (the main thing) */}
          <g filter={`url(#${id}-liquid)`}>
            <circle
              cx="100"
              cy="100"
              r="54"
              fill="none"
              stroke={`url(#${id}-grad)`}
              strokeWidth="10"
              strokeLinecap="round"
              opacity="0.95"
            />
            {/* inner ring for depth */}
            <circle
              cx="100"
              cy="100"
              r="48"
              fill="none"
              stroke={pal.a}
              strokeOpacity="0.22"
              strokeWidth="6"
            />
          </g>

          {/* Grain */}
          <rect
            x="0"
            y="0"
            width="200"
            height="200"
            filter={`url(#${id}-grain)`}
            opacity="0.35"
            style={{ mixBlendMode: "overlay" }}
          />
        </svg>

        {/* Score text (centered on top of ring) */}
        <div className="relative z-10 flex flex-col items-center">
          <motion.div
            className="text-white leading-none"
            style={{
              fontSize: '64px',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            {rounded}
          </motion.div>
          <div
            className="text-white/35 -mt-1"
            style={{
              fontSize: '12px',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontWeight: 400,
            }}
          >
            /100
          </div>
        </div>
      </div>

      {/* Zone label */}
      <div
        className="mt-2"
        style={{
          fontSize: '11px',
          letterSpacing: '0.25em',
          color: pal.zoneColor,
          fontFamily: 'Outfit, sans-serif',
          fontWeight: 500,
        }}
      >
        {pal.zone}
      </div>
    </div>
  );
}
