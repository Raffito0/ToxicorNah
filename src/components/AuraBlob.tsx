import { useEffect, useMemo } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

type AuraBlobProps = {
  score: number;
  size?: number;
  className?: string;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function palette(score: number) {
  const s = clamp(score);
  if (s <= 33) return {
    zone: "SAFE ZONE",
    zoneColor: "#6EE7B7"
  };
  if (s <= 66) return {
    zone: "RISKY ZONE",
    zoneColor: "#FCD34D"
  };
  return {
    zone: "TOXIC ZONE",
    zoneColor: "#F472B6"
  };
}

export function AuraBlob({ score, size = 280, className }: AuraBlobProps) {
  const pal = palette(score);

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

  const blobId = useMemo(() => `blob-${Math.random().toString(36).slice(2)}`, []);

  return (
    <div className={`relative flex flex-col items-center ${className ?? ""}`}>
      {/* Aura container */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        {/* Main blob container with all layers */}
        <div
          className="absolute inset-0 overflow-hidden rounded-full"
          style={{
            filter: 'blur(30px)',
          }}
        >
          {/* Layer 1 - Pink/Magenta rotating blob */}
          <motion.div
            className="absolute"
            style={{
              width: '140%',
              height: '140%',
              left: '-20%',
              top: '-20%',
              background: 'radial-gradient(ellipse 60% 50% at 30% 40%, rgba(255, 120, 200, 0.8) 0%, transparent 60%)',
            }}
            animate={{
              rotate: [0, 360],
            }}
            transition={{
              duration: 20,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          {/* Layer 2 - Orange/Yellow blob */}
          <motion.div
            className="absolute"
            style={{
              width: '140%',
              height: '140%',
              left: '-20%',
              top: '-20%',
              background: 'radial-gradient(ellipse 50% 60% at 70% 30%, rgba(255, 180, 80, 0.8) 0%, transparent 55%)',
            }}
            animate={{
              rotate: [360, 0],
            }}
            transition={{
              duration: 25,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          {/* Layer 3 - Yellow/Green blob */}
          <motion.div
            className="absolute"
            style={{
              width: '140%',
              height: '140%',
              left: '-20%',
              top: '-20%',
              background: 'radial-gradient(ellipse 55% 45% at 60% 70%, rgba(200, 255, 100, 0.7) 0%, transparent 50%)',
            }}
            animate={{
              rotate: [0, -360],
            }}
            transition={{
              duration: 22,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          {/* Layer 4 - Cyan/Blue blob */}
          <motion.div
            className="absolute"
            style={{
              width: '140%',
              height: '140%',
              left: '-20%',
              top: '-20%',
              background: 'radial-gradient(ellipse 45% 55% at 25% 65%, rgba(100, 200, 255, 0.7) 0%, transparent 55%)',
            }}
            animate={{
              rotate: [-360, 0],
            }}
            transition={{
              duration: 28,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          {/* Layer 5 - Purple/Violet blob */}
          <motion.div
            className="absolute"
            style={{
              width: '140%',
              height: '140%',
              left: '-20%',
              top: '-20%',
              background: 'radial-gradient(ellipse 50% 50% at 75% 55%, rgba(180, 100, 255, 0.7) 0%, transparent 50%)',
            }}
            animate={{
              rotate: [180, 540],
            }}
            transition={{
              duration: 24,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          {/* Center bright core */}
          <div
            className="absolute"
            style={{
              width: '100%',
              height: '100%',
              background: 'radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.4) 0%, rgba(255, 200, 150, 0.2) 25%, transparent 50%)',
            }}
          />
        </div>

        {/* Additional blur layer for extra softness */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle at 50% 50%, transparent 30%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0.8) 100%)',
          }}
        />

        {/* Grain overlay */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            opacity: 0.15,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            mixBlendMode: 'overlay',
          }}
        />

        {/* Score text (centered) */}
        <div className="relative z-10 flex flex-col items-center">
          <motion.div
            className="text-white leading-none"
            style={{
              fontSize: '64px',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              textShadow: '0 2px 30px rgba(0,0,0,0.6)',
            }}
          >
            {rounded}
          </motion.div>
          <div
            className="text-white/50 -mt-1"
            style={{
              fontSize: '14px',
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
        className="mt-3"
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
