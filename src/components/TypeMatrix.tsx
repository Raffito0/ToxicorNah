import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import type { TypeMatrixEntry } from '../services/soulProfileService';

interface TypeMatrixProps {
  entries: TypeMatrixEntry[];
  totalRelationships: number;
}

export function TypeMatrix({ entries, totalRelationships }: TypeMatrixProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      {/* Section Header */}
      <div className="mb-4">
        <h2
          className="text-white/50 text-sm font-semibold mb-1"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', letterSpacing: '0.05em' }}
        >
          YOUR TYPE MATRIX
        </h2>
        <p
          className="text-white/30"
          style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          How you show up with different types
        </p>
      </div>

      {/* Matrix Entries */}
      <div className="space-y-3">
        {entries.map((entry, index) => (
          <MatrixRow key={`${entry.hisArchetype}-${entry.yourArchetype}`} entry={entry} index={index} />
        ))}
      </div>

      {/* Footer */}
      <p
        className="text-white/20 text-center mt-4"
        style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
      >
        Based on {totalRelationships} relationship{totalRelationships !== 1 ? 's' : ''} analyzed
      </p>
    </div>
  );
}

function MatrixRow({ entry, index }: { entry: TypeMatrixEntry; index: number }) {
  return (
    <motion.div
      className="rounded-[20px] p-4 overflow-hidden"
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
    >
      {/* Archetype Pairing */}
      <div className="flex items-center justify-between mb-3">
        {/* His Archetype */}
        <div className="flex items-center gap-2 flex-1">
          {entry.hisArchetypeImage ? (
            <div
              className="w-10 h-10 rounded-full overflow-hidden bg-white/10"
              style={{ flexShrink: 0 }}
            >
              <img
                src={entry.hisArchetypeImage}
                alt={entry.hisArchetype}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #4a1a1a, #2d0808)',
                flexShrink: 0,
              }}
            >
              <span className="text-white/50 text-xs font-bold">
                {entry.hisArchetype.charAt(0)}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p
              className="text-white/40 truncate"
              style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              When he's
            </p>
            <p
              className="text-white font-semibold truncate"
              style={{ fontSize: '13px', fontFamily: 'Satoshi, sans-serif' }}
            >
              {entry.hisArchetype}
            </p>
          </div>
        </div>

        {/* Arrow */}
        <div className="px-3">
          <ArrowRight size={16} className="text-white/20" />
        </div>

        {/* Your Archetype */}
        <div className="flex items-center gap-2 flex-1 justify-end">
          <div className="min-w-0 text-right">
            <p
              className="text-white/40 truncate"
              style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              You become
            </p>
            <p
              className="text-white font-semibold truncate"
              style={{ fontSize: '13px', fontFamily: 'Satoshi, sans-serif' }}
            >
              {entry.yourArchetype}
            </p>
          </div>
          {entry.yourArchetypeImage ? (
            <div
              className="w-10 h-10 rounded-full overflow-hidden bg-white/10"
              style={{ flexShrink: 0 }}
            >
              <img
                src={entry.yourArchetypeImage}
                alt={entry.yourArchetype}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #3d2a6b, #1a1233)',
                flexShrink: 0,
              }}
            >
              <span className="text-white/50 text-xs font-bold">
                {entry.yourArchetype.charAt(0)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Insight */}
      <p
        className="text-white/50 italic"
        style={{
          fontSize: '12px',
          fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
          lineHeight: 1.4,
        }}
      >
        "{entry.insight}"
      </p>

      {/* Relationship Count Badge */}
      {entry.relationshipCount > 1 && (
        <div className="mt-2 flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded-full text-white/40"
            style={{
              fontSize: '10px',
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
              background: 'rgba(255, 255, 255, 0.05)',
            }}
          >
            {entry.relationshipCount}x pattern
          </span>
          <span
            className="text-white/30"
            style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            with {entry.personNames.slice(0, 2).join(', ')}
            {entry.personNames.length > 2 && ` +${entry.personNames.length - 2}`}
          </span>
        </div>
      )}
    </motion.div>
  );
}
