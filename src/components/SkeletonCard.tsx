import { motion } from 'framer-motion';

interface SkeletonCardProps {
  aspectRatio?: string;
  className?: string;
  rounded?: string;
}

export function SkeletonCard({
  aspectRatio = '3/4',
  className = '',
  rounded = '28px'
}: SkeletonCardProps) {
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        aspectRatio,
        background: '#1a1a1a',
        borderRadius: rounded
      }}
    >
      {/* Shimmer effect */}
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
        }}
        animate={{ x: ['-100%', '100%'] }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'linear',
          repeatDelay: 0.5
        }}
      />

      {/* Placeholder content at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-6">
        <div className="h-5 w-28 bg-white/10 rounded mb-3" />
        <div className="h-3 w-40 bg-white/5 rounded mb-2" />
        <div className="h-3 w-32 bg-white/5 rounded" />
      </div>
    </div>
  );
}

interface SkeletonStackProps {
  cardCount?: number;
  className?: string;
}

export function SkeletonCardStack({ cardCount = 3, className = '' }: SkeletonStackProps) {
  return (
    <div className={`relative ${className}`} style={{ aspectRatio: '3/4' }}>
      {Array.from({ length: cardCount }).map((_, index) => {
        const isTop = index === cardCount - 1;
        const rotation = isTop ? 0 : (index - 1) * 6;
        const translateY = index * 12;

        return (
          <motion.div
            key={index}
            className="absolute inset-0"
            style={{ zIndex: index }}
            animate={{
              rotate: rotation,
              y: translateY,
              scale: isTop ? 1.02 : 1,
            }}
          >
            <SkeletonCard />
          </motion.div>
        );
      })}
    </div>
  );
}
