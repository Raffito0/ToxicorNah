import { X, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';

interface ViralShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisId: string;
  onShareComplete: () => void;
}

export function ViralShareModal({
  isOpen,
  onClose,
  analysisId,
  onShareComplete
}: ViralShareModalProps) {
  async function handleShare(platform: 'tiktok' | 'instagram') {
    const sessionId = sessionStorage.getItem('toxic_or_nah_session_id') || '';
    const shareCode = `share_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const shareUrl = `${window.location.origin}?ref=${shareCode}`;
    const shareText = `Ho appena scoperto quanto è tossica la mia chat! 😱 Fai il test anche tu su Toxic or Nah`;

    const { error } = await supabase
      .from('viral_shares')
      .insert({
        session_id: sessionId,
        analysis_id: analysisId,
        platform,
        share_code: shareCode,
        share_verified: true,
        bonus_granted: false
      });

    if (error) {
      console.error('Error recording share:', error);
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Toxic or Nah - Chat Analysis',
          text: shareText,
          url: shareUrl
        });

        handleShareSuccess();
      } catch (err) {
        console.log('Share cancelled or failed:', err);
      }
    } else {
      navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      alert('Link copiato! Condividilo su TikTok o Instagram per sbloccare 1 analisi gratis');
      handleShareSuccess();
    }
  }

  async function handleShareSuccess() {
    const sessionId = sessionStorage.getItem('toxic_or_nah_session_id') || '';

    const { data: existingShares } = await supabase
      .from('viral_shares')
      .select('*')
      .eq('session_id', sessionId)
      .eq('bonus_granted', true);

    if (!existingShares || existingShares.length === 0) {
      await supabase
        .from('viral_shares')
        .update({ bonus_granted: true })
        .eq('session_id', sessionId)
        .eq('analysis_id', analysisId);

      const { data: tracking } = await supabase
        .from('user_analysis_tracking')
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (tracking) {
        await supabase
          .from('user_analysis_tracking')
          .update({
            free_bonus_unlocks: 1,
            updated_at: new Date().toISOString()
          })
          .eq('session_id', sessionId);
      }

      onShareComplete();
    }

    onClose();
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-md bg-gradient-to-b from-pink-900/50 to-black rounded-3xl p-8 shadow-2xl border border-pink-500/30"
        >
          <button
            onClick={onClose}
            className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="text-center mb-8">
            <div className="text-6xl mb-4">❤️</div>
            <h2 className="text-3xl text-white mb-3" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
              Vuoi 1 Analisi Completa GRATIS?
            </h2>
            <p className="text-white/80 text-lg leading-relaxed">
              Condividi questo risultato su TikTok o Instagram e sblocca la tua prossima analisi gratuitamente!
            </p>
          </div>

          <div className="space-y-4 mb-6">
            <button
              onClick={() => handleShare('tiktok')}
              className="w-full bg-gradient-to-r from-pink-600 to-red-600 hover:from-pink-500 hover:to-red-500 text-white rounded-2xl p-5 transition-all transform hover:scale-105 shadow-lg flex items-center justify-center gap-3"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              <Share2 className="w-5 h-5" />
              <span className="text-lg font-bold">Condividi su TikTok</span>
            </button>

            <button
              onClick={() => handleShare('instagram')}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-2xl p-5 transition-all transform hover:scale-105 shadow-lg flex items-center justify-center gap-3"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              <Share2 className="w-5 h-5" />
              <span className="text-lg font-bold">Condividi su Instagram</span>
            </button>

            <button
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white/60 rounded-2xl p-4 transition-all"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Non ora
            </button>
          </div>

          <div className="text-center space-y-2">
            <div className="text-sm text-white/60">
              ✨ Bonus valido solo 1 volta per utente
            </div>
            <div className="text-xs text-white/40">
              Aiutaci a crescere e ottieni analisi gratis!
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
