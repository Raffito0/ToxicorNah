import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bookmark, Share2, Check } from 'lucide-react';
import { InnerTruthContent, generateShareImage } from '../services/sigilsService';
import { haptics } from '../utils/haptics';

interface InnerTruthRevealProps {
  content: InnerTruthContent;
  onClose: () => void;
}

export function InnerTruthReveal({ content, onClose }: InnerTruthRevealProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const handleSave = () => {
    haptics.medium();
    setIsSaved(true);
    // TODO: Save to local storage or backend
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleShare = async () => {
    if (!content.canShare) return;
    haptics.medium();
    setIsSharing(true);

    try {
      const blob = await generateShareImage(content);
      if (!blob) {
        setIsSharing(false);
        return;
      }

      const file = new File([blob], 'inner-truth.png', { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Inner Truth',
          text: content.bigLine,
        });
        haptics.success();
      } else {
        // Fallback: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inner-truth.png';
        a.click();
        URL.revokeObjectURL(url);
        haptics.success();
      }
    } catch (err) {
      console.log('Share cancelled or failed');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-60 bg-black flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Background gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center top, rgba(212, 175, 55, 0.08) 0%, transparent 50%)',
        }}
      />

      {/* Close button */}
      <div className="flex justify-end px-5 pt-14">
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
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        {/* Gold line */}
        <motion.div
          className="w-16 h-0.5 rounded-full mb-8"
          style={{ background: 'rgba(212, 175, 55, 0.5)' }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        />

        {/* Eyebrow */}
        <motion.p
          className="uppercase tracking-widest mb-2"
          style={{
            fontSize: '11px',
            letterSpacing: '0.2em',
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200,
            color: 'rgba(212, 175, 55, 0.8)',
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          INNER TRUTH
        </motion.p>

        {/* Rubric Title */}
        <motion.h2
          className="text-white font-bold mb-6"
          style={{
            fontSize: '18px',
            fontFamily: 'Satoshi, sans-serif',
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {content.rubricLabel}
        </motion.h2>

        {/* Big Line */}
        <motion.p
          className="text-white font-bold mb-4"
          style={{
            fontSize: '26px',
            fontFamily: 'Satoshi, sans-serif',
            lineHeight: 1.3,
            maxWidth: '320px',
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          "{content.bigLine}"
        </motion.p>

        {/* Why (optional) */}
        {content.why && (
          <motion.p
            className="text-white/50 mb-6"
            style={{
              fontSize: '14px',
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
              lineHeight: 1.5,
              maxWidth: '280px',
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            {content.why}
          </motion.p>
        )}

        {/* Divider */}
        <motion.div
          className="w-12 h-px mb-6"
          style={{ background: 'rgba(255, 255, 255, 0.1)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        />

        {/* Move */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          <p
            className="text-white/40 uppercase tracking-widest mb-2"
            style={{ fontSize: '9px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
          >
            YOUR MOVE
          </p>
          <p
            className="text-white/70"
            style={{
              fontSize: '15px',
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
              lineHeight: 1.5,
              maxWidth: '280px',
            }}
          >
            {content.move}
          </p>
        </motion.div>
      </div>

      {/* Bottom CTAs */}
      <motion.div
        className="px-6 pb-10 space-y-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9 }}
      >
        {/* Save button */}
        <motion.button
          onClick={handleSave}
          className="w-full py-4 rounded-full flex items-center justify-center gap-2"
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
          whileTap={{ scale: 0.98 }}
        >
          <AnimatePresence mode="wait">
            {isSaved ? (
              <motion.div
                key="saved"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="flex items-center gap-2"
              >
                <Check size={18} className="text-green-400" />
                <span
                  className="text-green-400"
                  style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                >
                  Saved
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="save"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="flex items-center gap-2"
              >
                <Bookmark size={18} className="text-white/60" />
                <span
                  className="text-white/60"
                  style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                >
                  Save
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Share button (only for blind_spot and emotional_roi) */}
        {content.canShare && (
          <motion.button
            onClick={handleShare}
            disabled={isSharing}
            className="w-full py-4 rounded-full flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(212, 175, 55, 0.05) 100%)',
              border: '1px solid rgba(212, 175, 55, 0.3)',
            }}
            whileTap={{ scale: 0.98 }}
          >
            <Share2 size={18} style={{ color: 'rgba(212, 175, 55, 0.8)' }} />
            <span
              style={{
                fontSize: '14px',
                fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                color: 'rgba(212, 175, 55, 0.8)',
              }}
            >
              {isSharing ? 'Creating...' : 'Share'}
            </span>
          </motion.button>
        )}
      </motion.div>
    </motion.div>
  );
}
