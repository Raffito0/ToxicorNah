import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { fetchSigilsState, SigilsState, markInnerTruthOpened, markMirrorTruthSeen } from '../services/sigilsService';
import { haptics } from '../utils/haptics';
import { InnerTruthReveal } from './InnerTruthReveal';

interface SigilsScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onStateChange?: () => void;
}

export function SigilsScreen({ isOpen, onClose, onStateChange }: SigilsScreenProps) {
  const [state, setState] = useState<SigilsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInnerTruth, setShowInnerTruth] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadState();
    }
  }, [isOpen]);

  const loadState = async () => {
    setLoading(true);
    const data = await fetchSigilsState();
    setState(data);
    setLoading(false);
  };

  const handleBreakSeal = () => {
    if (!state?.innerTruth.current) return;
    haptics.medium();
    markInnerTruthOpened();
    setShowInnerTruth(true);
    onStateChange?.();
  };

  const handleCloseInnerTruth = () => {
    setShowInnerTruth(false);
    loadState(); // Refresh state
  };

  const handleOpenMirror = () => {
    haptics.light();
    // Mark all mirror truths as seen
    state?.mirror.newTruths.forEach(truth => {
      markMirrorTruthSeen(truth.id);
    });
    onStateChange?.();
    // TODO: Open Mirror sub-screen
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 bg-black"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-14 pb-4">
          <div>
            <p
              className="text-white/50 uppercase tracking-widest mb-1"
              style={{ fontSize: '12px', letterSpacing: '0.15em', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
            >
              SIGILS
            </p>
            <h1
              className="text-white text-2xl font-bold"
              style={{ fontFamily: 'Satoshi, sans-serif' }}
            >
              Break what's waiting
            </h1>
          </div>
          <motion.button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255, 255, 255, 0.05)' }}
            whileTap={{ scale: 0.95 }}
          >
            <X size={20} className="text-white/60" />
          </motion.button>
        </div>

        {/* Content */}
        <div className="px-5 pt-6 pb-24 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-white/30" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                Loading...
              </p>
            </div>
          ) : (
            <>
              {/* Module 1: Inner Truth */}
              <InnerTruthCard
                state={state?.innerTruth.state || 'waiting'}
                nextDropIn={state?.innerTruth.nextDropIn || 0}
                onBreakSeal={handleBreakSeal}
              />

              {/* Module 2: Mirror */}
              <MirrorCard
                newCount={state?.mirror.newTruths.filter(t => t.isNew).length || 0}
                waitingCount={state?.mirror.waitingCount || 0}
                hasSummary={!!state?.mirror.summary}
                onOpen={handleOpenMirror}
              />
            </>
          )}
        </div>

        {/* Inner Truth Reveal Overlay */}
        {showInnerTruth && state?.innerTruth.current && (
          <InnerTruthReveal
            content={state.innerTruth.current}
            onClose={handleCloseInnerTruth}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ===== INNER TRUTH CARD =====
interface InnerTruthCardProps {
  state: 'sealed' | 'opened' | 'waiting';
  nextDropIn: number;
  onBreakSeal: () => void;
}

function InnerTruthCard({ state, nextDropIn, onBreakSeal }: InnerTruthCardProps) {
  const getStatusText = () => {
    switch (state) {
      case 'sealed':
        return 'SEALED';
      case 'opened':
        return 'OPENED';
      case 'waiting':
        return `NEXT IN: ${nextDropIn} DAY${nextDropIn !== 1 ? 'S' : ''}`;
    }
  };

  const getStatusColor = () => {
    switch (state) {
      case 'sealed':
        return 'rgba(212, 175, 55, 0.8)'; // Gold
      case 'opened':
        return 'rgba(255, 255, 255, 0.4)';
      case 'waiting':
        return 'rgba(255, 255, 255, 0.3)';
    }
  };

  return (
    <motion.div
      className="relative w-full rounded-[28px] overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%)',
        border: '1px solid rgba(212, 175, 55, 0.15)',
        aspectRatio: '1 / 0.75',
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      {/* Blur + glow background effect */}
      {state === 'sealed' && (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(circle at center, rgba(212, 175, 55, 0.1) 0%, transparent 60%)',
            }}
          />
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(212, 175, 55, 0.2) 0%, transparent 70%)',
              filter: 'blur(20px)',
            }}
            animate={{
              opacity: [0.5, 0.8, 0.5],
              scale: [1, 1.1, 1],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </>
      )}

      {/* Status badge */}
      <div
        className="absolute top-4 right-4 px-3 py-1 rounded-full"
        style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: `1px solid ${getStatusColor()}`,
        }}
      >
        <span
          style={{
            fontSize: '10px',
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            color: getStatusColor(),
            fontWeight: 600,
            letterSpacing: '0.05em',
          }}
        >
          {getStatusText()}
        </span>
      </div>

      {/* Sigil icon in center when sealed */}
      {state === 'sealed' && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <motion.div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(212, 175, 55, 0.1)',
              border: '1px solid rgba(212, 175, 55, 0.3)',
            }}
            animate={{
              boxShadow: [
                '0 0 20px rgba(212, 175, 55, 0.2)',
                '0 0 40px rgba(212, 175, 55, 0.3)',
                '0 0 20px rgba(212, 175, 55, 0.2)',
              ],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <SigilSealIcon />
          </motion.div>
        </div>
      )}

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-6">
        <p
          className="text-white/50 uppercase tracking-widest mb-1"
          style={{ fontSize: '10px', letterSpacing: '0.15em', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
        >
          INNER TRUTH
        </p>
        <h3
          className="text-white font-bold mb-1"
          style={{ fontSize: '20px', fontFamily: 'Satoshi, sans-serif' }}
        >
          Weekly Drop
        </h3>
        <p
          className="text-white/40 mb-4"
          style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          One truth. One move.
        </p>

        {/* CTA */}
        {state === 'sealed' && (
          <motion.button
            onClick={onBreakSeal}
            className="w-full py-3 rounded-full font-medium"
            style={{
              background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.3) 0%, rgba(212, 175, 55, 0.1) 100%)',
              border: '1px solid rgba(212, 175, 55, 0.4)',
              color: 'rgba(212, 175, 55, 0.9)',
              fontSize: '14px',
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
            }}
            whileTap={{ scale: 0.98 }}
          >
            Break the seal
          </motion.button>
        )}

        {state === 'opened' && (
          <motion.button
            onClick={onBreakSeal}
            className="w-full py-3 rounded-full font-medium"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.5)',
              fontSize: '14px',
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
            }}
            whileTap={{ scale: 0.98 }}
          >
            View again
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

// ===== MIRROR CARD =====
interface MirrorCardProps {
  newCount: number;
  waitingCount: number;
  hasSummary: boolean;
  onOpen: () => void;
}

function MirrorCard({ newCount, waitingCount, hasSummary }: MirrorCardProps) {
  const getStatusText = () => {
    if (hasSummary) return 'SUMMARY UNLOCKED';
    if (newCount > 0) return `${newCount} NEW TRUTH${newCount !== 1 ? 'S' : ''}`;
    if (waitingCount > 0) return `WAITING: ${waitingCount} MORE`;
    return 'ACTIVE';
  };

  const getStatusColor = () => {
    if (hasSummary) return 'rgba(167, 139, 250, 0.8)'; // Purple
    if (newCount > 0) return 'rgba(147, 197, 253, 0.8)'; // Blue
    return 'rgba(255, 255, 255, 0.4)';
  };

  return (
    <motion.div
      className="relative w-full rounded-[28px] overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%)',
        border: '1px solid rgba(147, 197, 253, 0.1)',
        aspectRatio: '1 / 0.55',
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      {/* Glass/reflection effect */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, transparent 50%, rgba(255, 255, 255, 0.02) 100%)',
        }}
      />
      <div
        className="absolute top-0 left-0 right-0 h-1/2"
        style={{
          background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0.05) 0%, transparent 100%)',
        }}
      />

      {/* Status badge */}
      <div
        className="absolute top-4 right-4 px-3 py-1 rounded-full"
        style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: `1px solid ${getStatusColor()}`,
        }}
      >
        <span
          style={{
            fontSize: '10px',
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            color: getStatusColor(),
            fontWeight: 600,
            letterSpacing: '0.05em',
          }}
        >
          {getStatusText()}
        </span>
      </div>

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-6">
        <p
          className="text-white/50 uppercase tracking-widest mb-1"
          style={{ fontSize: '10px', letterSpacing: '0.15em', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
        >
          MIRROR
        </p>
        <h3
          className="text-white font-bold mb-1"
          style={{ fontSize: '20px', fontFamily: 'Satoshi, sans-serif' }}
        >
          Anonymous truths
        </h3>
        <p
          className="text-white/40 mb-4"
          style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          From your circle.
        </p>

        {/* CTA */}
        <motion.button
          className="w-full py-3 rounded-full font-medium"
          style={{
            background: newCount > 0
              ? 'linear-gradient(135deg, rgba(147, 197, 253, 0.2) 0%, rgba(147, 197, 253, 0.05) 100%)'
              : 'rgba(255, 255, 255, 0.05)',
            border: newCount > 0
              ? '1px solid rgba(147, 197, 253, 0.3)'
              : '1px solid rgba(255, 255, 255, 0.1)',
            color: newCount > 0
              ? 'rgba(147, 197, 253, 0.9)'
              : 'rgba(255, 255, 255, 0.5)',
            fontSize: '14px',
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
          }}
          whileTap={{ scale: 0.98 }}
        >
          Open Mirror
        </motion.button>
      </div>
    </motion.div>
  );
}

// ===== SIGIL SEAL ICON =====
function SigilSealIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="rgba(212, 175, 55, 0.6)"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M12 7C8.5 7 5.5 9.5 4 12C5.5 14.5 8.5 17 12 17C15.5 17 18.5 14.5 20 12C18.5 9.5 15.5 7 12 7Z"
        stroke="rgba(212, 175, 55, 0.6)"
        strokeWidth="1.5"
        fill="none"
      />
      <circle
        cx="12"
        cy="12"
        r="2.5"
        fill="rgba(212, 175, 55, 0.8)"
      />
    </svg>
  );
}
