import { motion } from 'framer-motion';
import { SoulTypeMedia } from './SoulTypeMedia';
import type { EvolutionPoint } from '../services/soulProfileService';

interface EvolutionTimelineProps {
  evolution: EvolutionPoint[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();

  // If same year, show "Jan 15"
  // If different year, show "Jan 2024"
  const month = date.toLocaleDateString('en-US', { month: 'short' });

  if (date.getFullYear() === now.getFullYear()) {
    // Check if it's this month
    if (date.getMonth() === now.getMonth()) {
      return 'Now';
    }
    return month;
  }

  return `${month} ${date.getFullYear()}`;
}

export function EvolutionTimeline({ evolution }: EvolutionTimelineProps) {
  if (evolution.length < 2) {
    // Not enough data to show evolution
    return null;
  }

  // Calculate growth score (simplified: based on ending at a "better" archetype)
  const positiveArchetypes = ['The Crown', 'The Clean Cut'];
  const lastArchetype = evolution[evolution.length - 1].archetype;
  const firstArchetype = evolution[0].archetype;

  let growthScore = 50; // Default neutral
  if (positiveArchetypes.includes(lastArchetype) && !positiveArchetypes.includes(firstArchetype)) {
    growthScore = 73 + Math.floor(Math.random() * 20); // 73-92
  } else if (!positiveArchetypes.includes(lastArchetype) && positiveArchetypes.includes(firstArchetype)) {
    growthScore = 25 + Math.floor(Math.random() * 20); // 25-44
  } else if (positiveArchetypes.includes(lastArchetype)) {
    growthScore = 80 + Math.floor(Math.random() * 15); // 80-94
  } else {
    growthScore = 40 + Math.floor(Math.random() * 25); // 40-64
  }

  return (
    <div className="w-full">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2
            className="text-white/50 text-sm font-semibold mb-1"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', letterSpacing: '0.05em' }}
          >
            YOUR EVOLUTION
          </h2>
          <p
            className="text-white/30"
            style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            How you've changed over time
          </p>
        </div>

        {/* Growth Score */}
        <div className="text-right">
          <p
            className="text-white font-bold"
            style={{ fontSize: '24px', fontFamily: 'Satoshi, sans-serif' }}
          >
            {growthScore}%
          </p>
          <p
            className="text-white/40"
            style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            Growth Score
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div
          className="absolute left-[19px] top-6 bottom-6 w-0.5"
          style={{
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.3) 100%)',
          }}
        />

        {/* Timeline entries */}
        <div className="space-y-1">
          {evolution.map((point, index) => {
            const isLast = index === evolution.length - 1;
            const isFirst = index === 0;

            // Gradient opacity based on position (older = more faded)
            const opacity = 0.4 + (index / evolution.length) * 0.6;

            return (
              <motion.div
                key={`${point.date}-${point.archetype}`}
                className="flex items-start gap-4 py-3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1, duration: 0.4 }}
              >
                {/* Node */}
                <div
                  className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isLast
                      ? 'linear-gradient(135deg, #3d2a6b, #1a1233)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: isLast ? '2px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {point.imageUrl ? (
                    <SoulTypeMedia
                      src={point.imageUrl}
                      alt={point.archetype}
                      className="w-full h-full rounded-full object-cover"
                      style={{ opacity }}
                    />
                  ) : (
                    <span
                      className="text-white/50 font-bold"
                      style={{ fontSize: '12px', fontFamily: 'Satoshi, sans-serif' }}
                    >
                      {point.archetype.charAt(0)}
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                  {/* Date */}
                  <p
                    className="text-white/40 mb-1"
                    style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                  >
                    {formatDate(point.date)}
                  </p>

                  {/* Archetype title */}
                  <p
                    className="text-white font-semibold"
                    style={{
                      fontSize: '14px',
                      fontFamily: 'Satoshi, sans-serif',
                      opacity: opacity,
                    }}
                  >
                    {point.archetype}
                  </p>

                  {/* Context */}
                  <p
                    className="text-white/30"
                    style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                  >
                    {isFirst ? 'Where you started' :
                     isLast ? 'Where you are now' :
                     `with ${point.personName}`}
                  </p>
                </div>

                {/* Status indicator for last item */}
                {isLast && (
                  <div
                    className="px-2 py-1 rounded-full"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      fontSize: '10px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                      color: 'rgba(255, 255, 255, 0.4)',
                    }}
                  >
                    Current
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Insight Message */}
      <motion.div
        className="mt-4 p-4 rounded-[16px]"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <p
          className="text-white/50 italic text-center"
          style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: 1.5 }}
        >
          {growthScore > 70
            ? "You've come a long way. Your patterns are shifting."
            : growthScore > 50
            ? "Growth isn't linear. You're learning with each analysis."
            : "Awareness is the first step. Keep analyzing, keep growing."}
        </p>
      </motion.div>
    </div>
  );
}
