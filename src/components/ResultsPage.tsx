import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock } from 'lucide-react';
import { toPng } from 'html-to-image';
import { getColorAtPercentage } from './ScoreRing';
import { ToxicOrb } from './ToxicOrb';
import { SwipeableCardDeck } from './SwipeableCardDeck';
import { VerticalCardDeck } from './VerticalCardDeck';
import { DynamicCard } from './DynamicCard';
import { ScrollReveal } from './ScrollReveal';
import { PaywallModal } from './PaywallModal';
import { KeepEyeOnHimModal } from './KeepEyeOnHimModal';
import { SoulTypeMedia } from './SoulTypeMedia';
import { getAnalysisResult, getAnalysisStatus, StoredAnalysisResult, computeDynamicGradient } from '../services/analysisService';
import { getUserState, canPurchaseSingleUnlock, canUseFirstFreeAnalysis } from '../services/userStateService';
import { createSubscriptionCheckout, createSingleUnlockCheckout } from '../services/stripeService';
import { supabase } from '../lib/supabase';
import { isDevMode } from '../utils/platform';
import { RELATIONSHIP_STATUS_OPTIONS } from '../services/personProfileService';

/**
 * Computes the DynamicCard gradient based on color similarity between
 * person and user archetype palettes. Finds the most similar color
 * between the two sets and generates a dark gradient from it.
 */
function getDynamicCardGradient(
  personTitle: string,
  userTitle: string
): { gradientStart: string; gradientEnd: string } {
  const gradient = computeDynamicGradient(personTitle, userTitle);
  return {
    gradientStart: gradient.from,
    gradientEnd: gradient.to
  };
}

function getToxicityLabel(score: number): string {
  if (score <= 30) return 'Barely a Red Flag';
  if (score <= 50) return 'Low-key Toxic';
  if (score <= 65) return 'Certified Toxic';
  if (score <= 80) return 'Dangerously Toxic';
  return 'Run.';
}

// Mini Score Ring for shareable card
function MiniScoreRing({ score, maxScore = 100 }: { score: number; maxScore?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 72;
  const radius = 28;
  const strokeWidth = 5;
  const percentage = score / maxScore;
  const color = getColorAtPercentage(percentage);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

    // Score arc with gradient
    const segments = 360;
    const totalSegments = Math.floor(segments * percentage);
    for (let i = 0; i < totalSegments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;
      const t = i / segments;
      const segColor = getColorAtPercentage(t);

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, angle - Math.PI / 2, nextAngle - Math.PI / 2);
      ctx.strokeStyle = segColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }, [score, maxScore, percentage]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <canvas ref={canvasRef} width={size} height={size} className="absolute inset-0" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="font-bold leading-none"
          style={{ fontSize: '20px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, color }}
        >
          {score}
        </span>
      </div>
    </div>
  );
}

interface ResultsPageProps {
  analysisId?: string;
  isGuest?: boolean;
}

export function ResultsPage({ analysisId, isGuest = false }: ResultsPageProps) {
  const [analysis, setAnalysis] = useState<StoredAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(true); // True until Phase 1 (quick) completes
  const [isDetailedLoading, setIsDetailedLoading] = useState(true); // True until Phase 2 (detailed) completes
  const [loadingMessage, setLoadingMessage] = useState("Reading the vibes...");
  const [showPaywall, setShowPaywall] = useState(false);

  // Compute halo color based on score zone (matches ToxicOrb palette)
  const haloColor = useMemo(() => {
    if (!analysis) return '#666666';
    const score = analysis.overallScore;
    if (score <= 33) return '#6EE7B7'; // Safe - emerald-300
    if (score <= 66) return '#FCD34D'; // Risky - amber-300
    return '#EF4444'; // Toxic - red-500
  }, [analysis?.overallScore]);
  const [userState, setUserState] = useState({
    isPremium: false,
    canUseSingleUnlock: true,
    singleUnlocksRemaining: 2,
    isFirstAnalysis: false
  });
  const [isArchetypeCardFlipped, setIsArchetypeCardFlipped] = useState(false);
  const [showArchetypeContent, setShowArchetypeContent] = useState(false);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [showKeepEyeModal, setShowKeepEyeModal] = useState(false);
  const [keepEyeModalDismissed, setKeepEyeModalDismissed] = useState(false);
  const shareableArchetypeRef = useRef<HTMLDivElement>(null);

  // Show "Keep an eye on him" modal 1s after paywall closes for first-time users
  const paywallWasOpened = useRef(false);
  useEffect(() => {
    if (showPaywall) {
      paywallWasOpened.current = true;
    } else if (paywallWasOpened.current && !keepEyeModalDismissed && userState.isFirstAnalysis) {
      // Paywall just closed — show "Keep an eye on him" after 1s
      const timer = setTimeout(() => {
        setShowKeepEyeModal(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showPaywall, keepEyeModalDismissed, userState.isFirstAnalysis]);

  const dynamicGradient = useMemo(() => {
    if (!analysis) return { gradientStart: '#162a3d', gradientEnd: '#0b1520' };
    return getDynamicCardGradient(analysis.personArchetype.title, analysis.userArchetype.title);
  }, [analysis?.personArchetype.title, analysis?.userArchetype.title]);

  useEffect(() => {
    loadUserState();
  }, [analysisId]);

  // Rotating loading messages
  useEffect(() => {
    if (!isLoading) return;

    const messages = [
      "Reading the vibes...",
      "Detecting patterns...",
      "Analyzing chemistry...",
      "Almost there..."
    ];
    let index = 0;

    const interval = setInterval(() => {
      index = (index + 1) % messages.length;
      setLoadingMessage(messages[index]);
    }, 3000);

    return () => clearInterval(interval);
  }, [isLoading]);

  // Polling for analysis status (two-phase)
  // Phase 1 (quick_ready): Shows score + soul type (~5-6s)
  // Phase 2 (completed): Shows all cards
  useEffect(() => {
    if (!analysisId) {
      setIsLoading(false);
      setIsDetailedLoading(false);
      return;
    }

    const checkResults = async () => {
      const status = getAnalysisStatus(analysisId);

      if (status === 'quick_ready' || status === 'completed') {
        try {
          const result = await getAnalysisResult(analysisId);
          if (result) {
            setAnalysis(result);
            // Phase 1 done - show score + soul type
            setIsLoading(false);

            // Check if Phase 2 is done
            if (status === 'completed') {
              setIsDetailedLoading(false);
            }
          }
        } catch (error) {
          console.error('Error loading analysis:', error);
          setIsLoading(false);
          setIsDetailedLoading(false);
        }
      } else if (status === 'error') {
        console.error('Analysis failed');
        setIsLoading(false);
        setIsDetailedLoading(false);
      }
      // If still 'pending', keep polling
    };

    // Check immediately
    checkResults();

    // Poll every 500ms
    const interval = setInterval(checkResults, 500);

    return () => clearInterval(interval);
  }, [analysisId]);

  async function loadUserState() {
    const state = await getUserState();
    setUserState({
      isPremium: state.isPremium,
      canUseSingleUnlock: canPurchaseSingleUnlock(state),
      singleUnlocksRemaining: 2 - state.singleUnlocksThisMonth,
      isFirstAnalysis: canUseFirstFreeAnalysis(state)
    });
  }

  function handleBlurredContentClick() {
    if (!analysis?.isUnlocked) {
      setShowPaywall(true);
    }
  }

  const handleShareArchetype = useCallback(async () => {
    if (!shareableArchetypeRef.current || isGeneratingShare || !analysis) return;
    setIsGeneratingShare(true);

    try {
      const dataUrl = await toPng(shareableArchetypeRef.current, {
        pixelRatio: 2,
        backgroundColor: '#0a0a0a',
        skipFonts: true,
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'toxic-or-nah-soul-type.png', { type: 'image/png' });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Toxic or Nah?',
          text: `${analysis.personArchetype.title} - ${getToxicityLabel(analysis.overallScore)}`
        });
      } else {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'toxic-or-nah-soul-type.png';
        link.click();
      }
    } catch (err) {
      console.error('Share failed:', err);
    } finally {
      setIsGeneratingShare(false);
    }
  }, [isGeneratingShare, analysis]);

  async function handleSubscribe(plan: 'annual' | 'monthly') {
    const { url, error } = await createSubscriptionCheckout(analysisId, plan, isGuest);

    if (error) {
      console.error('Subscription checkout error:', error);
      throw new Error(error);
    }

    if (url) {
      window.location.href = url;
    }
  }

  async function handleSingleUnlock() {
    if (!analysisId) {
      throw new Error('No analysis ID');
    }

    const { url, error } = await createSingleUnlockCheckout(analysisId, isGuest);

    if (error) {
      console.error('Single unlock checkout error:', error);
      throw new Error(error);
    }

    if (url) {
      window.location.href = url;
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (isLoading || !analysis) {
    // Show skeleton loading state - immediate redirect from upload
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="flex flex-col items-center justify-center pt-4 pb-4">
          <div className="w-full max-w-md px-[30px]">
            <div className="bg-black py-12">
              <div className="text-center mb-3">
                <motion.p
                  className="text-white/50 uppercase tracking-widest mb-2"
                  style={{ letterSpacing: '1.5px', fontSize: '16px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  Toxicity Score
                </motion.p>
                <motion.h1
                  className="text-white text-3xl mb-2"
                  style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  Analyzing...
                </motion.h1>
              </div>

              {/* Loading ToxicOrb */}
              <div className="my-8">
                <ToxicOrb score={0} size={140} isLoading={true} />
              </div>

              {/* Rotating loading message */}
              <motion.div
                className="text-center"
                key={loadingMessage}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
              >
                <p
                  className="text-white/50 uppercase"
                  style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                >
                  {loadingMessage}
                </p>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    );
  }


  // DEV MODE: Always unlock content in development
  // Set TEST_LOCKS to true to test the lock system locally
  const TEST_LOCKS = false;
  const isDev = !TEST_LOCKS && isDevMode();

  // Determine lock state:
  // - isPremium or analysis.isUnlocked = everything unlocked
  // - isFirstAnalysis (first-time free) = partial unlock (teaser mode)
  // - Otherwise = fully locked
  const isFullyUnlocked = isDev || userState.isPremium || analysis.isUnlocked;
  // When TEST_LOCKS is true, force first-time free mode for testing
  const isFirstTimeFree = TEST_LOCKS || (!isFullyUnlocked && userState.isFirstAnalysis);

  // Profile hero data
  const personAvatarUrl = analysis.personAvatar || null;
  const personRelStatus = analysis.personRelationshipStatus || null;
  const relStatusOption = personRelStatus ? RELATIONSHIP_STATUS_OPTIONS.find(o => o.value === personRelStatus) : null;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ===== Profile Hero Section (hidden for first-time users who haven't added a person yet) ===== */}
      {!isFirstTimeFree && (
      <div className="relative w-full overflow-hidden" style={{ minHeight: '38vh' }}>
        {/* Blurred archetype background */}
        <img
          src="/image_r6qZ9PP4_1770361994322_1024.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'blur(18px) brightness(0.9)', transform: 'scale(1.15)' }}
        />

        {/* Sfumato gradient overlay */}
        <img
          src="/Sfumato.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ zIndex: 1 }}
        />

        {/* Bottom fade to black */}
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{
            height: '70%',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.2) 25%, rgba(0,0,0,0.5) 45%, rgba(0,0,0,0.75) 60%, rgba(0,0,0,0.92) 75%, black 85%)',
            zIndex: 2,
          }}
        />

        {/* Content */}
        <div
          className="relative flex flex-col items-center justify-center text-center px-8 pt-12 pb-6"
          style={{ zIndex: 3, minHeight: '38vh' }}
        >
          {/* Avatar */}
          <motion.div
            className="relative"
            style={{ willChange: 'filter, transform, opacity' }}
            initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.2, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div
              className="w-24 h-24 rounded-full overflow-hidden relative"
            >
              {personAvatarUrl ? (
                <img src={personAvatarUrl} alt={analysis.personName} className="w-full h-full object-cover" />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${analysis.personArchetype.gradientFrom}, ${analysis.personArchetype.gradientTo})` }}
                >
                  <span className="text-white text-3xl font-semibold">
                    {analysis.personName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          </motion.div>

          {/* Name */}
          <motion.h1
            className="text-white mt-4"
            style={{ fontSize: '22px', fontWeight: 500, fontFamily: 'Plus Jakarta Sans, sans-serif', willChange: 'filter, transform, opacity' }}
            initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.4, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {analysis.personName}
          </motion.h1>

          {/* Relationship Status Pill */}
          {relStatusOption && (
            <motion.div
              className="mt-2 px-3 py-1 rounded-full flex items-center gap-1.5"
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                willChange: 'filter, transform, opacity',
              }}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ delay: 0.55, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <img src={relStatusOption.icon} alt="" className="w-5 h-5" />
              <span
                style={{
                  fontSize: '12px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontWeight: 200,
                  letterSpacing: '1.5px',
                  color: 'rgba(255, 255, 255, 0.7)',
                }}
              >
                {relStatusOption.label}
              </span>
            </motion.div>
          )}
        </div>
      </div>
      )}

      {/* Content — overlaps hero by 40px to hide any seam (same pattern as PersonProfile) */}
      <div className="relative flex flex-col items-center justify-center pb-4 bg-black" style={{ marginTop: isFirstTimeFree ? '0px' : '-40px', zIndex: 10 }}>
        <div className="w-full max-w-md px-[30px]">
          <div className="bg-black pt-4 pb-12">
            <div className="text-center mb-3">
              <motion.p
                className="text-white/50 uppercase tracking-widest mb-2"
                style={{ letterSpacing: '1.5px', fontSize: '16px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, willChange: 'filter, transform, opacity' }}
                initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                transition={{ delay: 0.7, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                Toxicity Score
              </motion.p>
              <motion.h1
                className="text-white text-3xl mb-2"
                style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', willChange: 'filter, transform, opacity' }}
                initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                transition={{ delay: 0.85, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                How Toxic {analysis.personGender === 'female' ? 'She Is' : 'He Is'}
              </motion.h1>
            </div>

            <motion.div
              className="my-8"
              style={{ willChange: 'filter, transform, opacity' }}
              initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ delay: 1.0, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <ToxicOrb score={analysis.overallScore} size={140} />
            </motion.div>

            <motion.div
              className="text-center mb-4"
              style={{ willChange: 'filter, transform, opacity' }}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ delay: 1.5, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <h2 className="text-2xl mb-2" style={{ color: haloColor, fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}>
                {analysis.overallScore > 66 ? 'Toxic AF' : analysis.profileType}
              </h2>
              <p className="text-white text-[18px]" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>{analysis.profileSubtitle}</p>
            </motion.div>

            <motion.p
              className="text-center mb-8 px-2"
              style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.55)', willChange: 'filter, transform, opacity' }}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ delay: 1.7, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {analysis.profileDescription}
            </motion.p>

          </div>
        </div>

        {/* His Soul Type Section */}
        <div className="w-full max-w-md pt-[19px] px-[30px]">
          {/* Section Header */}
          <div className="mb-6 text-center">
            <motion.p
              className="text-white/50 uppercase mb-2"
              style={{ fontSize: '16px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, willChange: 'filter, transform, opacity' }}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ delay: 1.9, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              Who {analysis.personGender === 'female' ? 'She' : 'He'} Is
            </motion.p>
            <motion.h2
              className="text-white text-3xl"
              style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', willChange: 'filter, transform, opacity' }}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ delay: 2.05, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {analysis.personGender === 'female' ? 'Her' : 'His'} Soul Type
            </motion.h2>
          </div>

          {/* Archetype Card - Flippable, starts showing back */}
          <motion.div
            style={{ willChange: 'filter, transform, opacity' }}
            initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ delay: 2.2, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
          <div
            className="relative w-full cursor-pointer"
            style={{
              perspective: '1000px',
              aspectRatio: '9/16',
            }}
            onClick={() => {
              // Only allow flip if not already flipped (one-way flip)
              if (!isArchetypeCardFlipped) {
                setIsArchetypeCardFlipped(true);
                // Start content animation during the flip (after 0.25s of a 0.6s flip)
                setTimeout(() => setShowArchetypeContent(true), 250);
              }
            }}
          >
            <motion.div
              className="relative w-full h-full"
              style={{ transformStyle: 'preserve-3d' }}
              initial={false}
              animate={{ rotateY: isArchetypeCardFlipped ? 0 : 180 }}
              transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
                          >
              {/* FRONT SIDE - The revealed archetype */}
              <div
                className="absolute inset-0 rounded-[28px] overflow-hidden"
                style={{
                  backfaceVisibility: 'hidden',
                  backgroundColor: '#111111',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
              >
                {/* Full vertical archetype image */}
                <SoulTypeMedia
                  src={analysis.personArchetype.imageUrl}
                  alt={analysis.personArchetype.title}
                  className="absolute inset-0 w-full h-full object-cover"
                />

                {/* Noise/Grain overlay */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    opacity: 0.06,
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                    mixBlendMode: 'overlay',
                  }}
                />

                {/* Glassmorphism + Content - only rendered after flip */}
                <AnimatePresence>
                  {showArchetypeContent && (
                    <>
                      {/* Glassmorphism layer - extended outside card bounds to cover edge glitches */}
                      <motion.div
                        key="glassmorphism"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                        style={{
                          position: 'absolute',
                          bottom: '-2px',
                          left: '-2px',
                          right: '-2px',
                          height: 'calc(65% + 2px)',
                          backdropFilter: 'blur(20px)',
                          WebkitBackdropFilter: 'blur(20px)',
                          maskImage: 'linear-gradient(to bottom, transparent 0%, black 50%, black 100%)',
                          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 50%, black 100%)',
                        }}
                      />
                      {/* Dark gradient overlay - extended to match */}
                      <motion.div
                        key="gradient"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                        style={{
                          position: 'absolute',
                          bottom: '-2px',
                          left: '-2px',
                          right: '-2px',
                          height: 'calc(55% + 2px)',
                          background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0.85) 100%)',
                        }}
                      />

                      {/* Content layer */}
                      <div
                        className="absolute left-0 right-0 bottom-0 px-6 pb-[40px] flex flex-col items-center text-center"
                      >
                        {/* Archetype Title - appears when glassmorphism is halfway through retraction */}
                        <motion.h3
                          key="title"
                          initial={{ opacity: 0, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.5, delay: 0.3 }}
                          style={{ fontSize: '32px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', lineHeight: '1.3', color: '#FFFFFF' }}
                        >
                          {analysis.personArchetype.title}
                        </motion.h3>

                        {/* Tagline */}
                        <motion.p
                          key="tagline"
                          className="mt-2 max-w-[280px]"
                          initial={{ opacity: 0, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.5, delay: 0.35 }}
                          style={{ fontSize: '17px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 300, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.85)', fontStyle: 'italic' }}
                        >
                          {analysis.personArchetype.tagline}
                        </motion.p>

                        {/* Description */}
                        <motion.p
                          key="description"
                          className="mt-2 max-w-[280px]"
                          initial={{ opacity: 0, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.5, delay: 0.38 }}
                          style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.6)' }}
                        >
                          {analysis.personArchetype.description}
                        </motion.p>

                        {/* Trait Pills */}
                        <motion.div
                          key="pills"
                          className="flex flex-wrap justify-center gap-2 mt-4"
                          initial={{ opacity: 0, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.5, delay: 0.46 }}
                        >
                    {(() => {
                      const traits = (analysis.personArchetype.traits || ['COLD', 'NARCISSIST', 'BOLD']).slice(0, 3);
                      let twoWordUsed = false;
                      return traits.map((trait, index) => {
                        const words = trait.split(' ');
                        let displayTrait: string;
                        if (words.length > 1 && !twoWordUsed) {
                          displayTrait = words.slice(0, 2).join(' ');
                          twoWordUsed = true;
                        } else {
                          displayTrait = words[0];
                        }
                        return (
                          <div
                            key={index}
                            className="px-3 py-1 rounded-full"
                            style={{
                              background: 'rgba(255, 255, 255, 0.1)',
                              backdropFilter: 'blur(10px)',
                              WebkitBackdropFilter: 'blur(10px)',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '10px',
                                fontFamily: 'Plus Jakarta Sans, sans-serif',
                                fontWeight: 200,
                                letterSpacing: '1.5px',
                                color: 'rgba(255, 255, 255, 0.9)',
                                textTransform: 'uppercase',
                              }}
                            >
                              {displayTrait}
                            </span>
                          </div>
                        );
                      });
                    })()}
                        </motion.div>
                      </div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* BACK SIDE - "Discover who he is" with glassmorphism */}
              <div
                className="absolute inset-0 rounded-[28px] overflow-hidden"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
              >
                {/* Background image - blurred for glassmorphism effect */}
                <SoulTypeMedia
                  src={analysis.personArchetype.imageUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{
                    transform: 'scaleX(-1) scale(1.1)',
                    filter: 'blur(20px)',
                  }}
                />

                {/* Dark overlay 20% */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                  }}
                />

                {/* Dark gradient layer - from bottom to top */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '0',
                    left: '0',
                    right: '0',
                    height: '100%',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.1) 60%, transparent 100%)',
                    zIndex: 1,
                  }}
                />

                {/* Centered content */}
                <div className="absolute inset-0 flex flex-col items-center justify-center px-8" style={{ zIndex: 2 }}>
                  {/* Tap icon */}
                  <img src="/hand.png" alt="Tap" className="w-8 h-8 opacity-70 mb-5" />

                  {/* Text */}
                  <p
                    className="text-white text-center"
                    style={{
                      fontSize: '14px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 200,
                      letterSpacing: '1.5px',
                    }}
                  >
                    Discover who {analysis.personGender === 'female' ? 'she' : 'he'} is
                  </p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* CALL HIM OUT Button */}
          {showArchetypeContent && (
            <motion.div
              className="mt-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              <button
                onClick={handleShareArchetype}
                disabled={isGeneratingShare}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full active:scale-95 transition-all disabled:opacity-50"
                style={{
                  background: '#7200B4',
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontWeight: 400,
                  letterSpacing: '1.5px'
                }}
              >
                <img src="/devil (1).png" alt="" className="w-5 h-5" />
                <span className="text-white font-medium" style={{ fontSize: '15px' }}>
                  {isGeneratingShare ? 'Generating...' : `CALL ${analysis.personGender === 'female' ? 'HER' : 'HIM'} OUT`}
                </span>
              </button>
            </motion.div>
          )}
          </motion.div>
        </div>

        {/* SwipeableCardDeck - Card 1 free, Cards 2-5 locked for first-time free */}
        <ScrollReveal>
          <SwipeableCardDeck
            analysisId={analysis.id}
            isFirstTimeFree={isFirstTimeFree}
            onPaywallOpen={() => setShowPaywall(true)}
            isLoading={isDetailedLoading}
          />
        </ScrollReveal>

        {/* VerticalCardDeck - Card 1 free, solutions + cards 2+ locked for first-time free */}
        <ScrollReveal>
          <VerticalCardDeck
            analysisId={analysis.id}
            isFirstTimeFree={isFirstTimeFree}
            onPaywallOpen={() => setShowPaywall(true)}
            isLoading={isDetailedLoading}
          />
        </ScrollReveal>

        {/* The Dynamic Section - Visuals free, text locked for first-time free */}
        <div className="w-full max-w-md pt-24 px-[30px]">
          <div className="text-center mb-8">
            <motion.p
              className="text-white/50 uppercase mb-2"
              style={{ letterSpacing: '1.5px', fontSize: '16px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, willChange: 'filter, transform, opacity' }}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
              whileInView={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              The Dynamic
            </motion.p>
            <motion.h2
              className="text-white text-3xl mb-2"
              style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', willChange: 'filter, transform, opacity' }}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
              whileInView={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ delay: 0.15, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              Your Souls Together
            </motion.h2>
          </div>
          <motion.div
            style={{ willChange: 'filter, transform, opacity' }}
            initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
            whileInView={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ delay: 0.3, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
          <DynamicCard
            dynamicName={analysis.relationshipDynamic.name}
            subtitle={analysis.relationshipDynamic.subtitle}
            whyThisHappens={analysis.relationshipDynamic.whyThisHappens}
            patternBreak={analysis.relationshipDynamic.patternBreak}
            powerBalance={analysis.relationshipDynamic.powerBalance}
            personName={analysis.personName}
            {...dynamicGradient}
            personArchetype={{
              name: analysis.personArchetype.name,
              title: analysis.personArchetype.title,
              imageUrl: analysis.personArchetype.imageUrl,
              sideProfileImageUrl: analysis.personArchetype.sideProfileImageUrl
            }}
            userArchetype={{
              name: analysis.userArchetype.name,
              title: analysis.userArchetype.title,
              imageUrl: analysis.userArchetype.imageUrl,
              sideProfileImageUrl: analysis.userArchetype.sideProfileImageUrl
            }}
            isFirstTimeFree={isFirstTimeFree}
            onPaywallOpen={() => setShowPaywall(true)}
            isLoading={isDetailedLoading}
          />
          </motion.div>

          {/* Share Dynamic Button */}
          <motion.div
            className="mt-6"
            style={{ willChange: 'filter, transform, opacity' }}
            initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
            whileInView={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ delay: 0.15, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <button
              className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full active:scale-95 transition-all"
              style={{
                background: '#7200B4',
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontWeight: 400,
                letterSpacing: '1.5px'
              }}
            >
              <img src="/devil (1).png" alt="" className="w-5 h-5" />
              <span className="text-white font-medium" style={{ fontSize: '15px' }}>
                SHARE YOUR DYNAMIC
              </span>
            </button>
          </motion.div>
        </div>

      </div>

      {/* Hidden Shareable Archetype Card (for html-to-image capture) */}
      <div
        ref={shareableArchetypeRef}
        className="fixed"
        style={{
          left: '-9999px',
          top: 0,
          width: '375px',
          background: '#0a0a0a',
          padding: '16px',
        }}
      >
        {analysis && (
          <>
            {/* Logo */}
            <div className="flex items-center justify-center mb-5">
              <img
                src="/logo-full.png"
                alt="Toxic or Nah?"
                className="h-7 object-contain"
              />
            </div>

            {/* The Shareable Card */}
            <div
              className="rounded-[28px] overflow-hidden"
              style={{ aspectRatio: '9/16', backgroundColor: '#111111' }}
            >
              {/* Full vertical archetype image */}
              <div className="relative w-full h-full">
                <SoulTypeMedia
                  src={analysis.personArchetype.imageUrl}
                  alt={analysis.personArchetype.title}
                  className="absolute inset-0 w-full h-full object-cover"
                />

                {/* Glassmorphism layer - extended outside card bounds to cover edge glitches */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-2px',
                    left: '-2px',
                    right: '-2px',
                    height: 'calc(65% + 2px)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    maskImage: 'linear-gradient(to bottom, transparent 0%, black 50%, black 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 50%, black 100%)',
                  }}
                />

                {/* Dark gradient overlay - extended to match */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-2px',
                    left: '-2px',
                    right: '-2px',
                    height: 'calc(55% + 2px)',
                    background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0.85) 100%)',
                  }}
                />

                {/* Content layer - with Toxic Score instead of pills */}
                <div
                  className="absolute left-0 right-0 px-6 flex flex-col items-center text-center"
                  style={{ top: 'calc(50% + 50% * 0.35 - 8px)' }}
                >
                  {/* Archetype Title */}
                  <h3
                    style={{
                      fontSize: '32px',
                      fontFamily: 'Outfit, sans-serif',
                      fontWeight: 500,
                      letterSpacing: '1.5px',
                      lineHeight: '1.3',
                      color: '#FFFFFF'
                    }}
                  >
                    {analysis.personArchetype.title}
                  </h3>

                  {/* Tagline */}
                  <p
                    className="mt-2 max-w-[280px]"
                    style={{
                      fontSize: '17px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 300,
                      letterSpacing: '1.5px',
                      color: 'rgba(255, 255, 255, 0.85)',
                      fontStyle: 'italic'
                    }}
                  >
                    {analysis.personArchetype.tagline}
                  </p>

                  {/* Description */}
                  <p
                    className="mt-2 max-w-[280px]"
                    style={{
                      fontSize: '13px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 200,
                      letterSpacing: '1.5px',
                      color: 'rgba(255, 255, 255, 0.6)'
                    }}
                  >
                    {analysis.personArchetype.description}
                  </p>

                  {/* Toxic Score Badge (instead of pills) */}
                  <div className="flex items-center justify-center gap-3 mt-4">
                    <MiniScoreRing score={analysis.overallScore} />
                    <div className="flex flex-col items-start">
                      <span
                        className="text-white"
                        style={{
                          fontSize: '18px',
                          fontFamily: 'Outfit, sans-serif',
                          fontWeight: 500,
                          letterSpacing: '1.5px'
                        }}
                      >
                        {getToxicityLabel(analysis.overallScore)}
                      </span>
                      <span
                        className="text-white/40"
                        style={{
                          fontSize: '12px',
                          fontFamily: 'Plus Jakarta Sans, sans-serif',
                          fontWeight: 200,
                          letterSpacing: '1.5px'
                        }}
                      >
                        Toxicity Score
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <KeepEyeOnHimModal
        isOpen={showKeepEyeModal}
        analysisId={analysisId || ''}
        personGender={analysis?.personGender || 'male'}
        canSkip={!userState.isPremium}
        onSaved={() => {
          setShowKeepEyeModal(false);
          setKeepEyeModalDismissed(true);
        }}
        onSkip={() => {
          setShowKeepEyeModal(false);
          setKeepEyeModalDismissed(true);
        }}
      />

      <PaywallModal
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={handleSubscribe}
        onSingleUnlock={handleSingleUnlock}
        canUseSingleUnlock={userState.canUseSingleUnlock}
        singleUnlocksRemaining={userState.singleUnlocksRemaining}
        isFirstAnalysis={userState.isFirstAnalysis}
        showSingleUnlock={true}
      />
    </div>
  );
}
