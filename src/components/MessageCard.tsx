import { useState } from 'react';
import { motion } from 'framer-motion';

interface MessageCardProps {
  title: string;
  message: string;
  description: string;
  cardNumber: string;
}

export function MessageCard({ title, message, description, cardNumber }: MessageCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      className="relative rounded-3xl overflow-hidden cursor-pointer"
      style={{ perspective: '1000px', WebkitPerspective: '1000px', minHeight: '280px', transform: 'translate3d(0,0,0)' } as React.CSSProperties}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <motion.div
        className="relative w-full h-full"
        style={{ transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d' } as React.CSSProperties}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
      >
        <div
          className="absolute w-full h-full bg-gradient-to-br from-red-900/40 to-red-700/40 rounded-3xl p-6 border border-red-900/30"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            backgroundColor: '#111111',
          } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded-full bg-red-500/30 flex items-center justify-center">
              <span className="text-red-300 text-xs">♪</span>
            </div>
            <span className="text-red-300 text-xs">Building Intimacy</span>
          </div>

          <h3 className="text-white text-xl mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>{title}</h3>
          <p className="text-gray-300 text-sm mb-6">{description}</p>

          <div className="absolute bottom-6 right-6 text-red-300 text-xs">
            {cardNumber}
          </div>

          <div className="absolute bottom-6 left-6 flex items-center gap-2 text-gray-400 text-xs">
            <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">↑</span>
            <span>Tap the card to see the solution</span>
          </div>
        </div>

        <div
          className="absolute w-full h-full bg-gradient-to-br from-red-900/40 to-orange-900/40 rounded-3xl p-6 border border-red-900/30"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            WebkitTransform: 'rotateY(180deg)',
            backgroundColor: '#111111',
          } as React.CSSProperties}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: isFlipped ? 1 : 0 }}
            transition={{ duration: 0.3, delay: isFlipped ? 0.4 : 0 }}
          >
            <div className="text-red-300 text-sm font-medium mb-4">Solution</div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">{message}</p>
            <div className="text-xs text-gray-500">Tap to return</div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
