import { useState } from 'react';
import { motion } from 'framer-motion';

interface FlipCardProps {
  front: React.ReactNode;
  back: React.ReactNode;
  className?: string;
}

export function FlipCard({ front, back, className = '' }: FlipCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      className={`relative cursor-pointer ${className}`}
      style={{ perspective: '1000px', WebkitPerspective: '1000px', transform: 'translate3d(0,0,0)' } as React.CSSProperties}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <motion.div
        className="relative w-full h-full"
        style={{ transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d' } as React.CSSProperties}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
      >
        <div
          className="absolute w-full h-full"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            backgroundColor: '#111111',
          } as React.CSSProperties}
        >
          {front}
        </div>
        <div
          className="absolute w-full h-full"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            WebkitTransform: 'rotateY(180deg)',
            backgroundColor: '#111111',
          } as React.CSSProperties}
        >
          <motion.div
            className="w-full h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: isFlipped ? 1 : 0 }}
            transition={{ duration: 0.3, delay: isFlipped ? 0.4 : 0 }}
          >
            {back}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
