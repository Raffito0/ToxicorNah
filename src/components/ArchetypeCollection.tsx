import { motion } from 'framer-motion';
import { Lock, Check } from 'lucide-react';
import { SoulTypeMedia } from './SoulTypeMedia';
import type { UnlockedArchetype } from '../services/soulProfileService';

interface ArchetypeCollectionProps {
  unlockedArchetypes: UnlockedArchetype[];
  archetypeRarities: Record<string, { percentage: number; rarity: 'common' | 'rare' | 'epic' }>;
}

// All 7 archetypes
const ALL_ARCHETYPES = [
  'The Echo',
  'The Moth',
  'The Volcano',
  'The Shadow',
  'The First Strike',
  'The Crown',
  'The Clean Cut',
];

const RARITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  common: { bg: 'rgba(255, 255, 255, 0.05)', text: 'text-white/40', border: 'border-white/10' },
  rare: { bg: 'rgba(147, 51, 234, 0.15)', text: 'text-purple-400', border: 'border-purple-500/30' },
  epic: { bg: 'rgba(234, 179, 8, 0.15)', text: 'text-yellow-400', border: 'border-yellow-500/30' },
};

export function ArchetypeCollection({ unlockedArchetypes, archetypeRarities }: ArchetypeCollectionProps) {
  const unlockedTitles = new Set(unlockedArchetypes.map(a => a.title));
  const unlockedCount = unlockedArchetypes.length;
  const totalCount = ALL_ARCHETYPES.length;

  // Find rarest unlocked archetype for the social comparison message
  let rarestUnlocked: { title: string; percentage: number } | null = null;
  unlockedArchetypes.forEach(a => {
    const rarity = archetypeRarities[a.title];
    if (rarity && (!rarestUnlocked || rarity.percentage < rarestUnlocked.percentage)) {
      rarestUnlocked = { title: a.title, percentage: rarity.percentage };
    }
  });

  return (
    <div className="w-full">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2
            className="text-white/50 text-sm font-semibold mb-1"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', letterSpacing: '0.05em' }}
          >
            ARCHETYPE COLLECTION
          </h2>
          <p
            className="text-white/30"
            style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            {unlockedCount}/{totalCount} Unlocked
          </p>
        </div>

        {/* Progress Ring */}
        <div className="relative w-12 h-12">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="rgba(255, 255, 255, 0.1)"
              strokeWidth="2"
            />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeDasharray={`${(unlockedCount / totalCount) * 100} 100`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="text-white font-bold"
              style={{ fontSize: '11px', fontFamily: 'Satoshi, sans-serif' }}
            >
              {unlockedCount}
            </span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3">
        {ALL_ARCHETYPES.map((title, index) => {
          const isUnlocked = unlockedTitles.has(title);
          const unlocked = unlockedArchetypes.find(a => a.title === title);
          const rarity = archetypeRarities[title] || { percentage: 20, rarity: 'common' };
          const rarityStyle = RARITY_COLORS[rarity.rarity];

          return (
            <motion.div
              key={title}
              className={`relative rounded-[16px] overflow-hidden border ${rarityStyle.border}`}
              style={{
                aspectRatio: '1/1',
                background: isUnlocked
                  ? `linear-gradient(135deg, ${unlocked?.gradientFrom || '#3d2a6b'}, ${unlocked?.gradientTo || '#1a1233'})`
                  : 'rgba(255, 255, 255, 0.02)',
              }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
            >
              {isUnlocked ? (
                // Unlocked state
                <>
                  {/* Image */}
                  {unlocked?.imageUrl && (
                    <SoulTypeMedia
                      src={unlocked.imageUrl}
                      alt={title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}

                  {/* Gradient overlay */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.8) 100%)',
                    }}
                  />

                  {/* Rarity badge */}
                  <div
                    className={`absolute top-2 right-2 px-2 py-0.5 rounded-full ${rarityStyle.text}`}
                    style={{
                      fontSize: '9px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                      background: rarityStyle.bg,
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    {rarity.rarity}
                  </div>

                  {/* Checkmark */}
                  <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check size={12} className="text-green-400" />
                  </div>

                  {/* Title */}
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p
                      className="text-white font-bold"
                      style={{ fontSize: '12px', fontFamily: 'Satoshi, sans-serif' }}
                    >
                      {title}
                    </p>
                    <p
                      className="text-white/40"
                      style={{ fontSize: '9px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                    >
                      via {unlocked?.personName}
                    </p>
                  </div>
                </>
              ) : (
                // Locked state
                <div className="absolute inset-0 flex flex-col items-center justify-center p-3">
                  {/* Lock icon */}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                    style={{ background: 'rgba(255, 255, 255, 0.05)' }}
                  >
                    <Lock size={18} className="text-white/20" />
                  </div>

                  {/* Mystery text */}
                  <p
                    className="text-white/30 font-bold"
                    style={{ fontSize: '14px', fontFamily: 'Satoshi, sans-serif' }}
                  >
                    ???
                  </p>

                  {/* Rarity hint */}
                  <p
                    className={`mt-1 ${rarityStyle.text}`}
                    style={{ fontSize: '9px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                  >
                    {rarity.rarity.toUpperCase()}
                  </p>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Social Comparison Message */}
      {rarestUnlocked && (
        <motion.p
          className="text-center text-white/30 mt-4"
          style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Only {rarestUnlocked.percentage}% of users have unlocked {rarestUnlocked.title}
        </motion.p>
      )}
    </div>
  );
}
