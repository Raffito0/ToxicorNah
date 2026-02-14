import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  velocityX: number;
  velocityY: number;
  shape: 'circle' | 'square' | 'star';
}

interface ConfettiExplosionProps {
  trigger: boolean;
  onComplete?: () => void;
  colors?: string[];
  particleCount?: number;
  duration?: number;
  originX?: number;
  originY?: number;
}

const CONFETTI_COLORS = [
  '#FFD700', // Gold
  '#FF6B6B', // Coral
  '#4ECDC4', // Teal
  '#A855F7', // Purple
  '#F472B6', // Pink
  '#22C55E', // Green
  '#3B82F6', // Blue
  '#F97316', // Orange
];

export function ConfettiExplosion({
  trigger,
  onComplete,
  colors = CONFETTI_COLORS,
  particleCount = 50,
  duration = 2000,
  originX = 50,
  originY = 50,
}: ConfettiExplosionProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (trigger && !isActive) {
      setIsActive(true);

      // Generate particles
      const newParticles: Particle[] = [];
      const shapes: ('circle' | 'square' | 'star')[] = ['circle', 'square', 'star'];

      for (let i = 0; i < particleCount; i++) {
        const angle = (Math.random() * Math.PI * 2);
        const velocity = 5 + Math.random() * 15;

        newParticles.push({
          id: i,
          x: originX,
          y: originY,
          size: 6 + Math.random() * 8,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * 360,
          velocityX: Math.cos(angle) * velocity,
          velocityY: Math.sin(angle) * velocity - 5, // Bias upward
          shape: shapes[Math.floor(Math.random() * shapes.length)],
        });
      }

      setParticles(newParticles);

      // Clear after duration
      const timeout = setTimeout(() => {
        setParticles([]);
        setIsActive(false);
        onComplete?.();
      }, duration);

      return () => clearTimeout(timeout);
    }
  }, [trigger, isActive, particleCount, colors, duration, originX, originY, onComplete]);

  const renderShape = (particle: Particle) => {
    switch (particle.shape) {
      case 'circle':
        return (
          <div
            style={{
              width: particle.size,
              height: particle.size,
              borderRadius: '50%',
              backgroundColor: particle.color,
            }}
          />
        );
      case 'square':
        return (
          <div
            style={{
              width: particle.size,
              height: particle.size,
              backgroundColor: particle.color,
              transform: `rotate(${particle.rotation}deg)`,
            }}
          />
        );
      case 'star':
        return (
          <svg
            width={particle.size}
            height={particle.size}
            viewBox="0 0 24 24"
            fill={particle.color}
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        );
    }
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      <AnimatePresence>
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            initial={{
              x: `${particle.x}%`,
              y: `${particle.y}%`,
              opacity: 1,
              scale: 0,
              rotate: particle.rotation,
            }}
            animate={{
              x: `${particle.x + particle.velocityX * 10}%`,
              y: `${particle.y + particle.velocityY * 10 + 50}%`, // Gravity effect
              opacity: 0,
              scale: [0, 1, 1, 0.5],
              rotate: particle.rotation + 720,
            }}
            transition={{
              duration: duration / 1000,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
            className="absolute"
            style={{
              left: 0,
              top: 0,
            }}
          >
            {renderShape(particle)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// Mini sparkle burst for smaller celebrations
export function SparklesBurst({
  trigger,
  onComplete,
  x = 50,
  y = 50,
}: {
  trigger: boolean;
  onComplete?: () => void;
  x?: number;
  y?: number;
}) {
  const [sparkles, setSparkles] = useState<{ id: number; angle: number; delay: number }[]>([]);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (trigger && !isActive) {
      setIsActive(true);

      const newSparkles = Array.from({ length: 8 }, (_, i) => ({
        id: i,
        angle: (i * 45) + Math.random() * 20 - 10,
        delay: Math.random() * 0.1,
      }));

      setSparkles(newSparkles);

      const timeout = setTimeout(() => {
        setSparkles([]);
        setIsActive(false);
        onComplete?.();
      }, 800);

      return () => clearTimeout(timeout);
    }
  }, [trigger, isActive, onComplete]);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <AnimatePresence>
        {sparkles.map((sparkle) => (
          <motion.div
            key={sparkle.id}
            initial={{
              scale: 0,
              opacity: 1,
              x: 0,
              y: 0,
            }}
            animate={{
              scale: [0, 1, 0],
              opacity: [1, 1, 0],
              x: Math.cos(sparkle.angle * Math.PI / 180) * 60,
              y: Math.sin(sparkle.angle * Math.PI / 180) * 60,
            }}
            transition={{
              duration: 0.6,
              delay: sparkle.delay,
              ease: 'easeOut',
            }}
            className="absolute"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="#FFD700"
            >
              <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2z" />
            </svg>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
