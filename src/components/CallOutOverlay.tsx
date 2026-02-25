import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Link2, MoreHorizontal } from 'lucide-react';
import { SoulTypeMedia } from './SoulTypeMedia';
import { ToxicOrb } from './ToxicOrb';
import { generateShareVideo } from '../utils/shareVideo';
import { createShareLink, copyToClipboard, type ShareableCardData } from '../services/shareService';
import { haptics } from '../utils/haptics';

function getToxicityLabel(score: number): string {
  if (score <= 30) return 'Barely a Red Flag';
  if (score <= 50) return 'Low-key Toxic';
  if (score <= 65) return 'Certified Toxic';
  if (score <= 80) return 'Dangerously Toxic';
  return 'Run.';
}

interface CallOutOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  soulTypeTitle: string;
  soulTypeTagline: string;
  soulTypeImageUrl: string;
  overallScore: number;
  personGender: 'male' | 'female';
  gradientFrom?: string;
  gradientTo?: string;
  sideProfileImageUrl?: string;
}

export function CallOutOverlay({
  isOpen,
  onClose,
  soulTypeTitle,
  soulTypeTagline,
  soulTypeImageUrl,
  overallScore,
  personGender,
  gradientFrom,
  gradientTo,
  sideProfileImageUrl,
}: CallOutOverlayProps) {
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [isCopyingLink, setIsCopyingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);
  const [cachedShareUrl, setCachedShareUrl] = useState<string | null>(null);

  const isAnyLoading = isGeneratingStory || isGeneratingVideo || isCopyingLink || isGeneratingMore;

  const generateVideo = useCallback(async () => {
    return generateShareVideo({
      videoSrc: soulTypeImageUrl,
      title: soulTypeTitle,
      tagline: soulTypeTagline,
      score: overallScore,
    });
  }, [soulTypeImageUrl, soulTypeTitle, soulTypeTagline, overallScore]);

  // Share to Instagram Stories — video via native share sheet
  const handleShareStories = useCallback(async () => {
    if (isAnyLoading) return;
    setIsGeneratingStory(true);
    haptics.medium();
    try {
      const videoBlob = await generateVideo();
      const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([videoBlob], `toxic-or-nah.${ext}`, { type: videoBlob.type });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Toxic or Nah?',
        });
      } else {
        // Fallback: download
        const url = URL.createObjectURL(videoBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `toxic-or-nah.${ext}`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('Share to Stories failed:', err);
      }
    } finally {
      setIsGeneratingStory(false);
    }
  }, [isAnyLoading, generateVideo]);

  // Save video — download directly
  const handleSaveVideo = useCallback(async () => {
    if (isAnyLoading) return;
    setIsGeneratingVideo(true);
    haptics.light();
    try {
      const videoBlob = await generateVideo();
      const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const url = URL.createObjectURL(videoBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `toxic-or-nah-${soulTypeTitle.toLowerCase().replace(/\s+/g, '-')}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Save video failed:', err);
    } finally {
      setIsGeneratingVideo(false);
    }
  }, [isAnyLoading, generateVideo, soulTypeTitle]);

  // Copy link — create share link in Supabase + copy to clipboard
  const handleCopyLink = useCallback(async () => {
    if (isAnyLoading) return;
    setIsCopyingLink(true);
    haptics.light();
    try {
      let shareUrl = cachedShareUrl;
      if (!shareUrl) {
        const data: ShareableCardData = {
          soulTypeTitle,
          soulTypeTagline,
          soulTypeImageUrl,
          overallScore,
          personGender,
          gradientFrom,
          gradientTo,
          ogImageUrl: sideProfileImageUrl || undefined,
        };
        shareUrl = await createShareLink(data);
        setCachedShareUrl(shareUrl);
      }
      await copyToClipboard(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error('Copy link failed:', err);
    } finally {
      setIsCopyingLink(false);
    }
  }, [isAnyLoading, cachedShareUrl, soulTypeTitle, soulTypeTagline, soulTypeImageUrl, overallScore, personGender, gradientFrom, gradientTo, sideProfileImageUrl]);

  // More... — video via native share sheet (full options)
  const handleMore = useCallback(async () => {
    if (isAnyLoading) return;
    setIsGeneratingMore(true);
    haptics.light();
    try {
      const videoBlob = await generateVideo();
      const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([videoBlob], `toxic-or-nah.${ext}`, { type: videoBlob.type });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Toxic or Nah?',
          text: `${soulTypeTitle} — ${getToxicityLabel(overallScore)}`,
        });
      } else {
        const url = URL.createObjectURL(videoBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `toxic-or-nah.${ext}`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    } finally {
      setIsGeneratingMore(false);
    }
  }, [isAnyLoading, generateVideo, soulTypeTitle, overallScore]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
          style={{ background: 'rgba(0, 0, 0, 0.92)' }}
          onClick={onClose}
        >
          {/* Close button */}
          <button
            className="absolute top-12 right-5 z-10 p-2 rounded-full"
            style={{ background: 'rgba(255,255,255,0.1)' }}
            onClick={onClose}
          >
            <X className="w-5 h-5 text-white/70" />
          </button>

          {/* Content */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="flex flex-col items-center w-full px-6"
            style={{ maxWidth: '360px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Card preview */}
            <div
              className="w-full rounded-[24px] overflow-hidden relative"
              style={{
                aspectRatio: '9/16',
                backgroundColor: '#111111',
                boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
              }}
            >
              <SoulTypeMedia
                src={soulTypeImageUrl}
                alt={soulTypeTitle}
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.8) 100%)' }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: '-2px',
                  left: '-2px',
                  right: '-2px',
                  height: 'calc(45% + 2px)',
                  background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.35) 100%)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
                }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 px-5 pb-10 flex flex-col items-center text-center"
                style={{ zIndex: 10 }}
              >
                <h3
                  style={{
                    fontSize: '31px',
                    fontFamily: 'Outfit, sans-serif',
                    fontWeight: 500,
                    letterSpacing: '1.5px',
                    lineHeight: '1.3',
                    color: '#FFFFFF',
                  }}
                >
                  {soulTypeTitle}
                </h3>
                <p
                  className="mt-2"
                  style={{
                    fontSize: '18px',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontWeight: 200,
                    letterSpacing: '1.5px',
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontStyle: 'italic',
                  }}
                >
                  {soulTypeTagline}
                </p>
                <div className="flex items-center justify-center gap-2.5 mt-4">
                  <ToxicOrb score={overallScore} size={46} fontSizeOverride={16} />
                  <div className="flex flex-col items-start">
                    <span
                      className="text-white font-bold"
                      style={{ fontSize: '19px', fontFamily: 'Satoshi, sans-serif' }}
                    >
                      {getToxicityLabel(overallScore)}
                    </span>
                    <span
                      className="text-white/40"
                      style={{
                        fontSize: '13px',
                        fontFamily: 'Plus Jakarta Sans, sans-serif',
                        fontWeight: 200,
                        letterSpacing: '1.5px',
                      }}
                    >
                      Toxicity Score
                    </span>
                  </div>
                </div>
                <img
                  src="/logo-group59.png"
                  alt="Toxic or Nah?"
                  className="mt-5"
                  style={{ height: '28px' }}
                />
              </div>
            </div>

            {/* === BUTTONS === */}
            <div className="w-full flex flex-col items-center gap-3 mt-5">
              {/* Primary: Share to Instagram Stories */}
              <button
                onClick={handleShareStories}
                disabled={isAnyLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full active:scale-95 transition-all disabled:opacity-50"
                style={{
                  background: '#7200B4',
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontWeight: 400,
                  letterSpacing: '1.5px',
                }}
              >
                {isGeneratingStory ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                )}
                <span className="text-white font-medium" style={{ fontSize: '15px' }}>
                  {isGeneratingStory ? 'Generating...' : 'Share to Instagram Stories'}
                </span>
              </button>

              {/* Secondary row: Save video + Copy link */}
              <div className="w-full flex gap-3">
                <button
                  onClick={handleSaveVideo}
                  disabled={isAnyLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-full active:scale-95 transition-all disabled:opacity-50"
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontWeight: 400,
                    letterSpacing: '1px',
                  }}
                >
                  {isGeneratingVideo ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 text-white/70" />
                  )}
                  <span className="text-white/80" style={{ fontSize: '14px' }}>
                    {isGeneratingVideo ? 'Saving...' : 'Save video'}
                  </span>
                </button>

                <button
                  onClick={handleCopyLink}
                  disabled={isAnyLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-full active:scale-95 transition-all disabled:opacity-50"
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontWeight: 400,
                    letterSpacing: '1px',
                  }}
                >
                  {isCopyingLink ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4 text-white/70" />
                  )}
                  <span className="text-white/80" style={{ fontSize: '14px' }}>
                    {linkCopied ? 'Copied!' : isCopyingLink ? 'Copying...' : 'Copy link'}
                  </span>
                </button>
              </div>

              {/* Tertiary: More... */}
              <button
                onClick={handleMore}
                disabled={isAnyLoading}
                className="flex items-center justify-center gap-1.5 py-2 active:scale-95 transition-all disabled:opacity-50"
              >
                {isGeneratingMore ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
                ) : (
                  <MoreHorizontal className="w-4 h-4 text-white/40" />
                )}
                <span
                  className="text-white/40"
                  style={{
                    fontSize: '14px',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontWeight: 300,
                    letterSpacing: '1px',
                  }}
                >
                  {isGeneratingMore ? 'Generating...' : 'More...'}
                </span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
