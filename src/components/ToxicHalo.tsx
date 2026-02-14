import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect } from "react";

type ToxicHaloProps = {
  score: number; // 0–100
  className?: string;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Palette map:
 * Safe: teal/green
 * Risky: amber/orange
 * Toxic: magenta/violet (+ subtle red warmth)
 */
function haloPalette(scoreRaw: number) {
  const s = clamp(scoreRaw);

  if (s <= 33) {
    return {
      core: ["rgba(0, 255, 209, .85)", "rgba(0, 180, 255, .35)"],
      haze: ["rgba(0, 255, 209, .28)", "rgba(0, 180, 255, .10)"],
      mist: ["rgba(0, 255, 209, .10)", "rgba(0,0,0,0)"],
      zone: "SAFE ZONE",
      zoneColor: "#6EE7B7", // emerald-300
    };
  }

  if (s <= 66) {
    return {
      core: ["rgba(255, 190, 80, .90)", "rgba(255, 110, 60, .35)"],
      haze: ["rgba(255, 190, 80, .28)", "rgba(255, 110, 60, .10)"],
      mist: ["rgba(255, 190, 80, .10)", "rgba(0,0,0,0)"],
      zone: "RISKY ZONE",
      zoneColor: "#FCD34D", // amber-300
    };
  }

  // Toxic (67–100)
  return {
    core: ["rgba(255, 70, 200, .92)", "rgba(115, 70, 255, .45)"], // magenta -> violet
    haze: ["rgba(180, 80, 255, .30)", "rgba(255, 70, 120, .12)"], // violet + warm pink
    mist: ["rgba(255, 90, 70, .10)", "rgba(0,0,0,0)"], // subtle red warmth
    zone: "TOXIC ZONE",
    zoneColor: "#F472B6", // pink-400
  };
}

export function ToxicHalo({ score, className }: ToxicHaloProps) {
  const pal = haloPalette(score);

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

  return (
    <div className={`relative w-full flex flex-col items-center ${className ?? ""}`}>
      {/* Halo Area */}
      <motion.div
        className="relative w-full max-w-[360px] h-[200px] flex items-center justify-center"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* OUTER MIST (very large, very soft) */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 320,
            height: 320,
            background: `radial-gradient(circle at 50% 50%, ${pal.mist[0]} 0%, ${pal.mist[1]} 65%)`,
            filter: 'blur(70px)',
          }}
          animate={{
            scale: [1, 1.015, 1],
            opacity: [0.28, 0.34, 0.28],
          }}
          transition={{
            duration: 3.4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* MID HAZE (main breathing aura) */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 230,
            height: 230,
            background: `radial-gradient(circle at 50% 50%, ${pal.haze[0]} 0%, ${pal.haze[1]} 62%, rgba(0,0,0,0) 78%)`,
            filter: 'blur(48px)',
            mixBlendMode: "screen",
          }}
          animate={{
            scale: [1, 1.03, 1],
            opacity: [0.62, 0.78, 0.62],
          }}
          transition={{
            duration: 3.2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* CORE GLOW (small, intense, almost still) */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 120,
            height: 120,
            background: `radial-gradient(circle at 50% 50%, ${pal.core[0]} 0%, ${pal.core[1]} 55%, rgba(0,0,0,0) 78%)`,
            filter: 'blur(22px)',
            mixBlendMode: "screen",
          }}
          animate={{
            scale: [1, 1.01, 1],
            opacity: [0.88, 0.95, 0.88],
          }}
          transition={{
            duration: 3.2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.05,
          }}
        />

        {/* Grain overlay (tactile) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.08,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E\")",
            mixBlendMode: "overlay",
          }}
        />

        {/* Score text */}
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
      </motion.div>

      {/* Zone label */}
      <div
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
