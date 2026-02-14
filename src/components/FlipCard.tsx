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
      style={{ perspective: '1000px' }}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <motion.div
        className="relative w-full h-full"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
      >
        <div
          className="absolute w-full h-full"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          {front}
        </div>
        <div
          className="absolute w-full h-full"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
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
