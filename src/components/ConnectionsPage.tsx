import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Users, X, Scale, Lock, Check } from 'lucide-react';
import {
  fetchConnections,
  ConnectionCardData,
} from '../services/connectionsService';
import { ToxicOrb } from './ToxicOrb';

interface ConnectionsPageProps {
  onAnalyzeNew: () => void;
  onSelectPerson: (personId: string) => void;
}

function ConnectionCard({ connection, onSelect, isCompareMode, isSelected }: {
  connection: ConnectionCardData;
  onSelect: () => void;
  isCompareMode?: boolean;
  isSelected?: boolean;
}) {
  const isHighToxicity = connection.currentScore > 60;
  const isMedToxicity = connection.currentScore > 30 && connection.currentScore <= 60;

  return (
    <button
      onClick={onSelect}
      className="relative rounded-2xl overflow-hidden w-full text-left transition-transform active:scale-[0.97]"
      style={{
        aspectRatio: '9/16',
        backgroundColor: '#111111',
        transform: 'translateZ(0)',
        boxShadow: isSelected
          ? '0 0 20px rgba(124, 58, 237, 0.4), inset 0 0 20px rgba(124, 58, 237, 0.1)'
          : isHighToxicity
          ? '0 0 20px rgba(239, 68, 68, 0.25), inset 0 0 20px rgba(239, 68, 68, 0.05)'
          : isMedToxicity
          ? '0 0 15px rgba(250, 204, 21, 0.15)'
          : 'none',
        border: 'none',
      }}
    >
      {/* Background: archetype image */}
      <img
        src={connection.archetypeImage || '/openart-image_SeQ6AwE2_1769430650812_raw.png'}
        alt={connection.archetypeTitle}
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Selection checkbox overlay in compare mode */}
      {isCompareMode && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div
            className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center"
            style={{
              background: isSelected ? '#7200B4' : 'rgba(0, 0, 0, 0.5)',
              border: isSelected ? '2px solid #7200B4' : '2px solid rgba(255, 255, 255, 0.3)',
            }}
          >
            {isSelected && <Check size={14} className="text-white" />}
          </div>
        </div>
      )}

      {/* Top overlay for badges */}
      <div className="absolute top-0 left-0 right-0 p-3 flex items-start justify-between z-10">
        {/* Chats badge (top-left) */}
        <div
          className="flex items-center gap-1 px-2.5 py-1 rounded-full"
          style={{
            background: 'rgba(255,255,255,0.71)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span
            className="text-black"
            style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            {connection.analysisCount} {connection.analysisCount === 1 ? 'Chat' : 'Chats'}
          </span>
        </div>

        {/* Score blob (top-right) — hidden in compare mode so checkbox doesn't overlap */}
        {!isCompareMode && (
          <ToxicOrb score={connection.currentScore} size={42} fontSizeOverride={13} />
        )}
      </div>

      {/* Glassmorphism layer - extended outside card bounds to cover edge glitches */}
      <div
        style={{
          position: 'absolute',
          bottom: '-2px',
          left: '-2px',
          right: '-2px',
          height: 'calc(50% + 2px)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 50%, black 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 50%, black 100%)',
          isolation: 'isolate',
        }}
      />
      {/* Dark gradient overlay - extended to match */}
      <div
        style={{
          position: 'absolute',
          bottom: '-2px',
          left: '-2px',
          right: '-2px',
          height: 'calc(45% + 2px)',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0.85) 100%)',
        }}
      />

      {/* Bottom info */}
      <div
        className="absolute bottom-0 left-0 right-0 p-3 z-10"
      >
        <div className="flex items-center gap-2">
          {/* Person avatar */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <img
              src={connection.avatar || '/Senza titolo.jpg'}
              alt={connection.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p
              className="text-white truncate"
              style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: '1.2' }}
            >
              {connection.name}
            </p>
            <p
              className="text-white/60 truncate"
              style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: '1.3' }}
            >
              {connection.archetypeTitle || 'Unknown'}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}

function EmptyCardSlot({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl flex flex-col items-center justify-center gap-2 transition-all hover:bg-white/[0.05] active:scale-[0.98]"
      style={{
        aspectRatio: '9/16',
        background: 'rgba(255,255,255,0.05)',
      }}
    >
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        <Plus size={22} className="text-white/40" />
      </div>
      <span
        className="text-white/35"
        style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
      >
        Analyze someone
      </span>
    </button>
  );
}

// ===== COMPARISON OVERLAY =====
function ComparisonOverlay({ personA, personB, onClose }: {
  personA: ConnectionCardData;
  personB: ConnectionCardData;
  onClose: () => void;
}) {
  const worse = personA.currentScore > personB.currentScore ? personA : personB;
  const better = personA.currentScore > personB.currentScore ? personB : personA;
  const scoreDiff = Math.abs(personA.currentScore - personB.currentScore);

  const getVerdict = () => {
    if (scoreDiff <= 5) return { text: "They're equally toxic", color: '#facc15' };
    if (worse.currentScore > 60) return { text: `${worse.name} is way more toxic`, color: '#ef4444' };
    if (worse.currentScore > 30) return { text: `${worse.name} is more sus`, color: '#facc15' };
    return { text: `${better.name} is the safer bet`, color: '#4ade80' };
  };
  const verdict = getVerdict();

  const getScoreColor = (score: number) => {
    if (score <= 30) return '#4ade80';
    if (score <= 60) return '#facc15';
    return '#ef4444';
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-5"
        style={{ background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(10px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-sm rounded-[28px] overflow-hidden"
          style={{
            background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.06) 0%, rgba(0, 0, 0, 0.92) 100%)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center z-10"
            style={{ background: 'rgba(255, 255, 255, 0.1)' }}
          >
            <X size={18} style={{ color: 'rgba(255, 255, 255, 0.6)' }} />
          </button>

          {/* Header */}
          <div className="pt-6 pb-4 text-center">
            <Scale size={24} style={{ color: 'rgba(255, 255, 255, 0.4)' }} className="mx-auto mb-3" />
            <h3
              className="text-white"
              style={{ fontSize: '20px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
            >
              Who's Worse?
            </h3>
          </div>

          {/* Side by side */}
          <div className="flex px-5 gap-4 pb-4">
            {/* Person A */}
            <div className="flex-1 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full overflow-hidden mb-2" style={{ border: `2px solid ${getScoreColor(personA.currentScore)}30` }}>
                <img src={personA.avatar || '/Senza titolo.jpg'} alt={personA.name} className="w-full h-full object-cover" />
              </div>
              <p className="text-white text-sm mb-1" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 400 }}>
                {personA.name}
              </p>
              <p className="text-white/40 mb-3" style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                {personA.archetypeTitle}
              </p>
              <ToxicOrb score={personA.currentScore} size={70} fontSizeOverride={20} />
            </div>

            {/* VS divider */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-white/20" style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                vs
              </span>
            </div>

            {/* Person B */}
            <div className="flex-1 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full overflow-hidden mb-2" style={{ border: `2px solid ${getScoreColor(personB.currentScore)}30` }}>
                <img src={personB.avatar || '/Senza titolo.jpg'} alt={personB.name} className="w-full h-full object-cover" />
              </div>
              <p className="text-white text-sm mb-1" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 400 }}>
                {personB.name}
              </p>
              <p className="text-white/40 mb-3" style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                {personB.archetypeTitle}
              </p>
              <ToxicOrb score={personB.currentScore} size={70} fontSizeOverride={20} />
            </div>
          </div>

          {/* Divider */}
          <div className="h-px mx-5" style={{ background: 'rgba(255, 255, 255, 0.06)' }} />

          {/* Verdict */}
          <div className="px-5 py-5 text-center">
            <p
              className="uppercase mb-1"
              style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.4)' }}
            >
              The Verdict
            </p>
            <p
              style={{ fontSize: '18px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', color: verdict.color }}
            >
              {verdict.text}
            </p>
            {scoreDiff > 5 && (
              <p
                className="mt-2"
                style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '0.5px', color: 'rgba(255, 255, 255, 0.4)', lineHeight: '1.5' }}
              >
                {worse.name} scores {scoreDiff} points higher in toxicity.{' '}
                {better.currentScore <= 30 ? `${better.name} seems like the real deal.` : `Neither is great, but ${better.name} is less of a risk.`}
              </p>
            )}
          </div>

          {/* Close CTA */}
          <div className="px-5 pb-6">
            <button
              onClick={onClose}
              className="w-full py-3 rounded-full text-white/60 active:scale-95 transition-transform"
              style={{ background: 'rgba(255, 255, 255, 0.05)', fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function ConnectionsPage({ onAnalyzeNew, onSelectPerson }: ConnectionsPageProps) {
  const [connections, setConnections] = useState<ConnectionCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  useEffect(() => {
    loadConnections();
  }, []);

  async function loadConnections() {
    setLoading(true);
    const data = await fetchConnections();
    setConnections(data);
    setLoading(false);
  }

  const canCompare = connections.length >= 2;
  const totalChats = connections.reduce((sum, c) => sum + c.analysisCount, 0);

  function handleCardClick(personId: string) {
    if (!compareMode) {
      onSelectPerson(personId);
      return;
    }

    // In compare mode: toggle selection (max 2)
    setSelectedIds(prev => {
      if (prev.includes(personId)) {
        return prev.filter(id => id !== personId);
      }
      if (prev.length >= 2) {
        // Replace the first selected with the new one
        return [prev[1], personId];
      }
      return [...prev, personId];
    });
  }

  function handleCompareClick() {
    if (!canCompare) return;
    if (compareMode) {
      // Exit compare mode
      setCompareMode(false);
      setSelectedIds([]);
    } else {
      setCompareMode(true);
      setSelectedIds([]);
    }
  }

  function handleCompareNow() {
    if (selectedIds.length === 2) {
      setShowComparison(true);
    }
  }

  function handleCloseComparison() {
    setShowComparison(false);
    setCompareMode(false);
    setSelectedIds([]);
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-black px-5 pt-14 pb-24">
        <h1
          className="text-white text-3xl mb-6"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          Your Receipts
        </h1>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-2xl animate-pulse"
              style={{
                aspectRatio: '9/16',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (connections.length === 0) {
    return (
      <div className="min-h-screen bg-black px-5 pt-14 pb-24">
        <h1
          className="text-white text-3xl mb-8"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          Your Receipts
        </h1>
        <div className="flex flex-col items-center justify-center mt-16 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
            <Users size={28} className="text-white/30" />
          </div>
          <p
            className="text-white/50 text-base mb-2"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            No connections yet
          </p>
          <p
            className="text-white/30 text-sm max-w-[240px] mb-6"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            Analyze a conversation to start building your collection
          </p>
          <button
            onClick={onAnalyzeNew}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-white/70 hover:text-white transition-colors"
            style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
              fontSize: '14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <Plus size={16} />
            Analyze Someone
          </button>
        </div>

        {/* Compare button — disabled */}
        <div className="mt-10 text-center">
          <button
            disabled
            className="flex items-center justify-center gap-2 mx-auto px-5 py-2.5 rounded-full transition-colors"
            style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
              fontSize: '14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              opacity: 0.4,
            }}
          >
            <Lock size={14} className="text-white/30" />
            <span className="text-white/30">Compare</span>
          </button>
          <p
            className="mt-2"
            style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '0.5px', color: 'rgba(255, 255, 255, 0.2)' }}
          >
            Analyze at least 2 guys to unlock
          </p>
        </div>
      </div>
    );
  }

  // Show exactly 1 empty slot after connections
  const emptySlotsCount = 1;

  const personA = connections.find(c => c.personId === selectedIds[0]);
  const personB = connections.find(c => c.personId === selectedIds[1]);

  return (
    <div className="min-h-screen bg-black px-5 pt-14 pb-24">
      {/* Header */}
      <h1
        className="text-white text-3xl mb-2"
        style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
      >
        Your Receipts
      </h1>

      {/* Stats */}
      <p
        className="text-white/30 mb-4"
        style={{ fontSize: '15px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
      >
        {connections.length} {connections.length === 1 ? 'person' : 'people'} · {totalChats} {totalChats === 1 ? 'chat' : 'chats'} analyzed
      </p>

      {/* Compare Button */}
      <div className="mb-5">
        <button
          onClick={handleCompareClick}
          disabled={!canCompare}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-full transition-all active:scale-[0.97]"
          style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontWeight: compareMode ? 500 : 400,
            letterSpacing: '1.5px',
            fontSize: '15px',
            textTransform: 'uppercase',
            background: compareMode
              ? '#FFFFFF'
              : canCompare
              ? 'rgba(255, 255, 255, 0.06)'
              : 'rgba(255, 255, 255, 0.03)',
            border: 'none',
            opacity: canCompare ? 1 : 0.4,
            color: compareMode ? '#000000' : canCompare ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.3)',
          }}
        >
          {!canCompare && <Lock size={14} />}
          {canCompare && <Scale size={16} />}
          <span>{compareMode ? 'CANCEL COMPARE' : 'COMPARE'}</span>
        </button>
        {!canCompare && (
          <p
            className="mt-2 text-center"
            style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '0.5px', color: 'rgba(255, 255, 255, 0.2)' }}
          >
            Analyze at least 2 guys to unlock
          </p>
        )}
      </div>

      {/* Compare mode instructions */}
      {compareMode && (
        <motion.p
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-4"
          style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.5)' }}
        >
          {selectedIds.length === 0 && 'Select 2 guys to compare'}
          {selectedIds.length === 1 && 'Select 1 more'}
          {selectedIds.length === 2 && 'Ready to compare!'}
        </motion.p>
      )}

      {/* Card Grid */}
      <div className="grid grid-cols-2 gap-3">
        {connections.map((connection) => (
          <ConnectionCard
            key={connection.personId}
            connection={connection}
            onSelect={() => handleCardClick(connection.personId)}
            isCompareMode={compareMode}
            isSelected={selectedIds.includes(connection.personId)}
          />
        ))}
        {/* Empty slots for collection effect */}
        {!compareMode && Array.from({ length: emptySlotsCount }).map((_, i) => (
          <EmptyCardSlot key={`empty-${i}`} onClick={onAnalyzeNew} />
        ))}
      </div>

      {/* Compare Now floating button */}
      <AnimatePresence>
        {compareMode && selectedIds.length === 2 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-28 left-0 right-0 flex justify-center z-40 px-5"
          >
            <button
              onClick={handleCompareNow}
              className="px-8 py-3.5 rounded-full text-white active:scale-95 transition-transform"
              style={{
                background: '#7200B4',
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontWeight: 400,
                letterSpacing: '1.5px',
                fontSize: '15px',
                textTransform: 'uppercase',
                boxShadow: '0 8px 30px rgba(114, 0, 180, 0.4)',
              }}
            >
              COMPARE NOW
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison Overlay */}
      {showComparison && personA && personB && (
        <ComparisonOverlay
          personA={personA}
          personB={personB}
          onClose={handleCloseComparison}
        />
      )}
    </div>
  );
}
