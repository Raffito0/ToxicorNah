import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Diamond, Upload, ChevronRight, Sparkles, AlertTriangle, Crown, Heart, Zap, RefreshCw, Eye, X, Bell, BellOff, User, Shield, Users, Star, HelpCircle, FileText, LogOut, Trash2, CreditCard, RotateCcw, UserX, MessageCircle, Lock } from 'lucide-react';
import { SoulTypeMedia } from './SoulTypeMedia';
import { fetchSoulProfile, SoulProfileData } from '../services/soulProfileService';
import { fetchSigilsState, SigilsState } from '../services/sigilsService';
import { haptics } from '../utils/haptics';
import { SigilIcon } from './SigilIcon';
import { SigilsScreen } from './SigilsScreen';
import { PaywallModal } from './PaywallModal';
import { getUserState, UserState, canPurchaseSingleUnlock } from '../services/userStateService';
import { createSubscriptionCheckout, createSingleUnlockCheckout, createCustomerPortalSession, getSubscriptionDetails } from '../services/stripeService';
import { supabase } from '../lib/supabase';

// ===== Section animation wrapper =====
function Section({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

// ===== Section Header (uppercase label + big title) =====
function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className="mb-6">
      <p
        className="text-white/50 uppercase mb-2"
        style={{ fontSize: '16px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
      >
        {label}
      </p>
      <h2
        className="text-white text-3xl"
        style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
      >
        {title}
      </h2>
    </div>
  );
}

// ===== Noise/Grain Overlay =====
function NoiseOverlay({ opacity = 0.06 }: { opacity?: number }) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        opacity,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        mixBlendMode: 'overlay',
      }}
    />
  );
}

// ===== Unified Film Overlay for non-archetype cards =====
// Includes: vignette + grain + subtle glow
interface FilmOverlayProps {
  vignette?: boolean;
  grain?: boolean;
  glowColor?: string;
  vignetteIntensity?: number;
  grainOpacity?: number;
}

function FilmOverlay({
  vignette = true,
  grain = true,
  glowColor = 'rgba(255, 255, 255, 0.06)',
  vignetteIntensity = 0.4,
  grainOpacity = 0.05,
}: FilmOverlayProps) {
  return (
    <>
      {/* Vignette effect */}
      {vignette && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, ${vignetteIntensity}) 100%)`,
            backfaceVisibility: 'hidden',
          }}
        />
      )}
      {/* Grain texture */}
      {grain && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: grainOpacity,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
            mixBlendMode: 'overlay',
            backfaceVisibility: 'hidden',
          }}
        />
      )}
      {/* Subtle inner glow */}
      <div
        className="absolute inset-0 pointer-events-none rounded-[inherit]"
        style={{
          boxShadow: `inset 0 0 40px ${glowColor}`,
          backfaceVisibility: 'hidden',
        }}
      />
    </>
  );
}

// Dev: Avatar image for the girl's profile
const DEV_USER_AVATAR = '/Screenshot 2026-01-26 205602.png';

// ===== HERO SECTION - Same style as PersonProfile =====
interface HeroSectionProps {
  data: SoulProfileData;
  sigilsState: SigilsState | null;
  onSigilClick: () => void;
  onAvatarClick: () => void;
}

function HeroSection({ data, sigilsState, onSigilClick, onAvatarClick }: HeroSectionProps) {
  const { dominantArchetype } = data;
  const [isAvatarPressed, setIsAvatarPressed] = useState(false);

  // Use the same archetype image as in the card for the background
  const archetypeImage = '/image_Us3UjM02_1770046314508_1024.jpg';
  const accentColor = '#A855F7';

  return (
    <div className="relative w-full overflow-hidden" style={{ minHeight: '35vh' }}>
      {/* Blurred archetype background - using the card's archetype image */}
      <img
        src={archetypeImage}
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

      {/* Bottom fade to black — seamless transition */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: '50%',
          background: 'linear-gradient(to bottom, transparent 0%, black 100%)',
          zIndex: 2,
        }}
      />

      {/* Sigil Icon - Top Right */}
      <div className="absolute top-4 right-4" style={{ zIndex: 10 }}>
        <SigilIcon
          hasNew={sigilsState?.badge.hasNew || false}
          count={sigilsState?.badge.count || 0}
          priority={sigilsState?.badge.priority || null}
          onClick={onSigilClick}
        />
      </div>

      {/* Content */}
      <div className="relative flex flex-col items-center text-center px-8 pt-16 pb-8" style={{ zIndex: 3 }}>
        {/* Avatar with Pulsing Halo - Clickable for settings */}
        <motion.button
          onClick={() => {
            haptics.light();
            onAvatarClick();
          }}
          onTouchStart={() => setIsAvatarPressed(true)}
          onTouchEnd={() => setIsAvatarPressed(false)}
          onMouseDown={() => setIsAvatarPressed(true)}
          onMouseUp={() => setIsAvatarPressed(false)}
          onMouseLeave={() => setIsAvatarPressed(false)}
          className="relative"
          whileTap={{ scale: 0.95 }}
        >
          {/* Outer pulsing halo ring */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              margin: '-4px',
              border: `1.5px solid ${accentColor}`,
            }}
            animate={{
              opacity: isAvatarPressed ? [0.8, 1, 0.8] : [0.3, 0.6, 0.3],
              scale: isAvatarPressed ? [1, 1.08, 1] : [1, 1.05, 1],
            }}
            transition={{
              duration: isAvatarPressed ? 0.8 : 2.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          {/* Avatar container */}
          <div
            className="w-24 h-24 rounded-full overflow-hidden relative"
            style={{
              border: `2px solid ${accentColor}60`,
            }}
          >
            <img
              src={DEV_USER_AVATAR}
              alt="Your profile"
              className="w-full h-full object-cover"
            />
          </div>
        </motion.button>

        {/* Title */}
        <h1
          className="mt-4"
          style={{ fontSize: '22px', fontWeight: 500, fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#A855F7' }}
        >
          Your Soul
        </h1>

        {/* Archetype title - same color as inside the card */}
        <p
          className="mt-1"
          style={{ fontSize: '24px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', color: '#FFFFFF' }}
        >
          {dominantArchetype.title}
        </p>

        {/* Tagline */}
        <p
          className="mt-2 max-w-[280px]"
          style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255,255,255,0.5)' }}
        >
          {dominantArchetype.tagline}
        </p>
      </div>
    </div>
  );
}

// Accent color for user's archetype card (lavender/purple tone)
const USER_ARCHETYPE_ACCENT = '#b988e8';

// Dev: hardcoded image for design
const DEV_USER_ARCHETYPE_IMAGE = '/Adobe Exprddess - file 1 (3).png';

// ===== YOUR ARCHETYPE SECTION - Full image style like PersonProfile =====
function YourArchetypeSection({ data }: { data: SoulProfileData }) {
  const { dominantArchetype } = data;
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);

  return (
    <Section className="px-5" style={{ marginTop: '45px' }}>
      {/* Custom header with archetype name */}
      <div className="mb-6">
        <p
          className="text-white/50 uppercase mb-2"
          style={{ fontSize: '16px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
        >
          Who You Are
        </p>
        <div className="relative flex items-center gap-2">
          <h2
            className="text-white text-3xl"
            style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
          >
            Your Soul Type
          </h2>
          {/* Info Icon */}
          <motion.button
            onClick={() => setShowInfoTooltip(!showInfoTooltip)}
            animate={{
              boxShadow: [
                '0 0 0px rgba(255,255,255,0.2)',
                '0 0 8px rgba(255,255,255,0.4)',
                '0 0 0px rgba(255,255,255,0.2)',
              ],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="w-5 h-5 rounded-full flex items-center justify-center text-white/60 hover:text-white/80 transition-colors"
            style={{
              background: 'rgba(255,255,255,0.15)',
              fontSize: '11px',
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
              fontWeight: 700,
              border: '1px solid rgba(255,255,255,0.25)',
            }}
          >
            ?
          </motion.button>

          {/* Tooltip */}
          <AnimatePresence>
            {showInfoTooltip && (
              <motion.div
                initial={{ opacity: 0, y: -5, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -5, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="absolute left-0 top-full mt-2 z-50"
              >
                <div
                  className="rounded-xl px-4 py-3 max-w-[280px]"
                  style={{
                    background: 'rgba(30, 30, 35, 0.98)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
                  }}
                >
                  <p
                    className="text-white/80"
                    style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: 1.5 }}
                  >
                    Your Soul evolves with every chat you analyze. The more you explore, the clearer your patterns become.
                  </p>
                  <button
                    onClick={() => setShowInfoTooltip(false)}
                    className="mt-2 text-white/40 hover:text-white/60 transition-colors"
                    style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                  >
                    Got it
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* The Card - Full vertical image with sfumato overlay */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="rounded-[28px] overflow-hidden relative"
        style={{
          aspectRatio: '9/16',
          backgroundColor: '#111111',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        {/* Full vertical archetype image */}
        <img
          src={DEV_USER_ARCHETYPE_IMAGE}
          alt={dominantArchetype.title}
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Gradient overlay for text readability */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.6) 100%)',
          }}
        />

        {/* Noise/Grain overlay */}
        <NoiseOverlay />

        {/* Glassmorphism background layer (with mask fade) - extended outside card bounds to cover edge glitches */}
        <div
          style={{
            position: 'absolute',
            bottom: '-2px',
            left: '-2px',
            right: '-2px',
            height: 'calc(55% + 2px)',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.35) 40%, rgba(0, 0, 0, 0.35) 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
          }}
        />

        {/* Content layer (not affected by mask) */}
        <div
          className="absolute bottom-0 left-0 right-0 px-6 pb-[40px] flex flex-col items-center text-center"
        >
          {/* Archetype Title (HERO) */}
          <h3
            style={{ fontSize: '32px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', lineHeight: '1.3', color: '#FFFFFF' }}
          >
            {dominantArchetype.title}
          </h3>

          {/* Punchy Tagline */}
          <p
            className="mt-1"
            style={{ fontSize: '17px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 400, color: '#FFFFFF' }}
          >
            You can't stay away from the fire
          </p>

          {/* Description - 2-3 lines */}
          <p
            className="text-white/70 mt-3 max-w-[280px]"
            style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: '1.6' }}
          >
            You feel everything deeply and love with your whole heart. Sometimes that's your superpower, sometimes it's your downfall.
          </p>

          {/* Trait Pills - matching HIS SOUL TYPE standard */}
          {dominantArchetype.traits && dominantArchetype.traits.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {(() => {
                let twoWordUsed = false;
                return dominantArchetype.traits.slice(0, 3).map((trait, i) => {
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
                      key={i}
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
            </div>
          )}
        </div>
      </motion.div>

      {/* Share Button */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.2 }}
        whileTap={{ scale: 0.97 }}
        className="w-full flex items-center justify-center gap-2 mt-6 px-6 py-3.5 rounded-full active:scale-95 transition-all"
        style={{
          background: '#7200B4',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontWeight: 400,
          letterSpacing: '1.5px',
        }}
      >
        <img
          src="/epasdicene (1).png"
          alt=""
          className="w-6 h-6 object-contain"
        />
        <span className="text-white" style={{ fontSize: '15px', fontWeight: 400, fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px' }}>
          SHARE YOUR SOUL
        </span>
      </motion.button>
    </Section>
  );
}

export function SoulPage() {
  const [data, setData] = useState<SoulProfileData | null>(null);
  const [sigilsState, setSigilsState] = useState<SigilsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSigils, setShowSigils] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [userState, setUserState] = useState<UserState | null>(null);
  const [paywallState, setPaywallState] = useState({
    canUseSingleUnlock: true,
    singleUnlocksRemaining: 2,
    isFirstAnalysis: false
  });

  // Determine if premium sections should be locked
  // TEMPORARILY UNLOCKED - set to false to unlock all sections
  const isPremium = userState?.isPremium ?? false;
  const sectionsLocked = false;

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [profile, sigils, state] = await Promise.all([
          fetchSoulProfile(),
          fetchSigilsState(),
          getUserState(),
        ]);
        setData(profile);
        setSigilsState(sigils);
        setUserState(state);
        setPaywallState({
          canUseSingleUnlock: canPurchaseSingleUnlock(state),
          singleUnlocksRemaining: 2 - state.singleUnlocksThisMonth,
          isFirstAnalysis: !state.firstAnalysisCompleted
        });
      } catch (err) {
        console.error('Error loading soul profile:', err);
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleSigilClick = () => {
    haptics.light();
    setShowSigils(true);
  };

  const handleSigilsClose = () => {
    setShowSigils(false);
  };

  const handleSigilsStateChange = async () => {
    // Refresh sigils state when something changes
    const newState = await fetchSigilsState();
    setSigilsState(newState);
  };

  const handleAvatarClick = () => {
    setShowSettings(true);
  };

  const handleSettingsClose = () => {
    setShowSettings(false);
  };

  const handlePaywallOpen = () => {
    setShowPaywall(true);
  };

  async function handleSubscribe(plan: 'annual' | 'monthly') {
    const { url, error } = await createSubscriptionCheckout(undefined, plan);

    if (error) {
      console.error('Subscription checkout error:', error);
      throw new Error(error);
    }

    if (url) {
      window.location.href = url;
    }
  }

  async function handleSingleUnlock() {
    const { url, error } = await createSingleUnlockCheckout('soul-profile');

    if (error) {
      console.error('Single unlock checkout error:', error);
      throw new Error(error);
    }

    if (url) {
      window.location.href = url;
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-black px-5 pt-14 pb-24 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-white/30"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          Loading your soul...
        </motion.div>
      </div>
    );
  }

  // Empty state: 0 analyses
  if (!data || data.analysisCount === 0) {
    return <EmptyStateZero />;
  }

  // Full profile
  return (
    <div className="min-h-screen bg-black pb-24">
      {/* Hero Section - Same style as PersonProfile */}
      <HeroSection
        data={data}
        sigilsState={sigilsState}
        onSigilClick={handleSigilClick}
        onAvatarClick={handleAvatarClick}
      />

      {/* Your Archetype Section - FREE for all users */}
      <YourArchetypeSection data={data} />

      {/* Good/Bad Traits Section - FREE for all users */}
      <GoodBadTraitsSection />

      {/* PREMIUM SECTIONS - Cards blurred for non-subscribers, headers visible */}

      {/* Soul Rarity Section - PREMIUM - TEMPORARILY DISABLED */}
      {/* <SoulRaritySection isLocked={sectionsLocked} onUnlockClick={handlePaywallOpen} /> */}

      {/* The Soul You Attract Section - PREMIUM */}
      <TypeYouAttractSection isLocked={sectionsLocked} onUnlockClick={handlePaywallOpen} />

      {/* Soul Compatibility Section - PREMIUM */}
      <SoulCompatibilitySection isLocked={sectionsLocked} onUnlockClick={handlePaywallOpen} />

      {/* Mistakes You Keep Making Section - PREMIUM */}
      <MistakesSection isLocked={sectionsLocked} onUnlockClick={handlePaywallOpen} />

      {/* You Are Becoming Section - PREMIUM */}
      <YouAreBecomingSection isLocked={sectionsLocked} onUnlockClick={handlePaywallOpen} />

      {/* Sigils Screen Overlay */}
      <SigilsScreen
        isOpen={showSigils}
        onClose={handleSigilsClose}
        onStateChange={handleSigilsStateChange}
      />

      {/* Settings Bottom Sheet */}
      <SettingsBottomSheet
        isOpen={showSettings}
        onClose={handleSettingsClose}
        userData={{
          name: 'Sarah',
          avatar: DEV_USER_AVATAR,
          archetype: data.dominantArchetype.title,
          isPremium: isPremium,
        }}
      />

      {/* Paywall Modal */}
      <PaywallModal
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={handleSubscribe}
        onSingleUnlock={handleSingleUnlock}
        canUseSingleUnlock={paywallState.canUseSingleUnlock}
        singleUnlocksRemaining={paywallState.singleUnlocksRemaining}
        isFirstAnalysis={paywallState.isFirstAnalysis}
      />
    </div>
  );
}

// ===== DAILY TRUTH - Your Two Sides (Tarot Reveal Style) =====
function GoodBadTraitsSection() {
  const [shadowRevealed, setShadowRevealed] = useState(false);

  // Mock data - changes daily based on date seed
  const today = new Date().getDate();
  const lightTraits = [
    { trait: "Emotionally Intelligent", tagline: "You see what others miss." },
    { trait: "Fiercely Loyal", tagline: "All in or nothing at all." },
    { trait: "Intuitively Aware", tagline: "Your gut is rarely wrong." },
    { trait: "Deeply Empathetic", tagline: "You feel everything they hide." },
  ];
  const shadowTraits = [
    { trait: "Over-Giver", tagline: "You drain yourself for crumbs." },
    { trait: "Excuse Maker", tagline: "Red flags look pink through your eyes." },
    { trait: "Chaos Seeker", tagline: "Stability bores you. Dangerous." },
    { trait: "Boundary Blurrer", tagline: "You erase your own lines for him." },
  ];

  const lightIndex = today % lightTraits.length;
  const shadowIndex = (today + 2) % shadowTraits.length;

  const handleRevealShadow = () => {
    setShadowRevealed(true);
    haptics.medium();
  };

  // Card dimensions - larger but not as big as archetype card
  const CARD_WIDTH = 260;
  const CARD_HEIGHT = 340;

  // Background images for each card
  const LIGHT_CARD_BG = '/8775dc3a00c74asdfbf86175ec5e5d05b03.jpg';
  const SHADOW_CARD_BG = '/openart-133abcf6-5b12-4106-aaa3-86576b7909b5.png';

  return (
    <Section className="pt-24 px-5">
      {/* Centered Header */}
      <div className="text-center mb-6">
        <p
          className="text-white/50 uppercase mb-2"
          style={{ fontSize: '16px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
        >
          Daily Truth
        </p>
        <h2
          className="text-white text-3xl"
          style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
        >
          Your Two Sides
        </h2>
      </div>

      {/* Card Deck Stack - Tappable to flip */}
      <div
        className="relative mx-auto cursor-pointer"
        style={{
          width: `${CARD_WIDTH}px`,
          height: `${CARD_HEIGHT}px`,
          perspective: '1000px',
        }}
        onClick={handleRevealShadow}
      >
        {/* Shadow Card (Behind) */}
        <motion.div
          className="absolute inset-0 rounded-[24px] overflow-hidden"
          initial={false}
          animate={{
            rotateY: shadowRevealed ? 0 : 180,
            z: shadowRevealed ? 10 : 0,
            scale: shadowRevealed ? 1 : 0.92,
          }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          style={{
            transformStyle: 'preserve-3d',
            backfaceVisibility: 'hidden',
            borderTop: '1px solid rgba(239, 68, 68, 0.3)',
            borderLeft: '1px solid rgba(239, 68, 68, 0.3)',
            borderRight: '1px solid rgba(239, 68, 68, 0.3)',
            borderBottom: 'none',
            zIndex: shadowRevealed ? 2 : 1,
            boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
          }}
        >
          {/* Background Image */}
          <img
            src={SHADOW_CARD_BG}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Dark gradient overlay */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.65) 0%, rgba(0, 0, 0, 0.35) 50%, transparent 100%)',
            }}
          />
          {/* Film Overlay: vignette + grain + glow */}
          <FilmOverlay vignetteIntensity={0.5} grainOpacity={0.06} glowColor="rgba(239, 68, 68, 0.08)" />

          {/* Gradient overlay for text readability */}
          <div
            style={{
              position: 'absolute',
              bottom: '-4px',
              left: '-4px',
              right: '-4px',
              height: 'calc(75% + 4px)',
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.6) 35%, rgba(0, 0, 0, 0.25) 65%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Content layer */}
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center text-center p-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: shadowRevealed ? 1 : 0 }}
            transition={{ duration: 0.3, delay: shadowRevealed ? 0.4 : 0 }}
          >
            {/* Label */}
            <p
              className="text-xs uppercase tracking-widest mb-2"
              style={{ color: '#ff9f9f', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', letterSpacing: '0.15em' }}
            >
              Your Shadow
            </p>

            {/* Trait Name */}
            <h3
              className="text-white font-bold mb-2"
              style={{ fontSize: '20px', fontFamily: 'Satoshi, sans-serif' }}
            >
              {shadowTraits[shadowIndex].trait}
            </h3>

            {/* Tagline */}
            <p
              style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: 1.6, color: 'rgba(255, 255, 255, 0.7)' }}
            >
              {shadowTraits[shadowIndex].tagline}
            </p>
          </motion.div>
        </motion.div>

        {/* Light Card (Front) */}
        <motion.div
          className="absolute inset-0 rounded-[24px] overflow-hidden"
          initial={false}
          animate={{
            rotateY: shadowRevealed ? -180 : 0,
            z: shadowRevealed ? 0 : 10,
            scale: shadowRevealed ? 0.92 : 1,
          }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          style={{
            transformStyle: 'preserve-3d',
            backfaceVisibility: 'hidden',
            borderTop: '1px solid rgba(34, 197, 94, 0.3)',
            borderLeft: '1px solid rgba(34, 197, 94, 0.3)',
            borderRight: '1px solid rgba(34, 197, 94, 0.3)',
            borderBottom: 'none',
            zIndex: shadowRevealed ? 1 : 2,
            boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
          }}
        >
          {/* Background Image */}
          <img
            src={LIGHT_CARD_BG}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Dark gradient overlay */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.65) 0%, rgba(0, 0, 0, 0.35) 50%, transparent 100%)',
            }}
          />
          {/* Film Overlay: vignette + grain + glow */}
          <FilmOverlay vignetteIntensity={0.5} grainOpacity={0.06} glowColor="rgba(34, 197, 94, 0.08)" />

          {/* Gradient overlay for text readability */}
          <div
            style={{
              position: 'absolute',
              bottom: '-4px',
              left: '-4px',
              right: '-4px',
              height: 'calc(75% + 4px)',
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.6) 35%, rgba(0, 0, 0, 0.25) 65%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Content layer */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-5">
            {/* Label */}
            <p
              className="text-xs uppercase tracking-widest mb-2"
              style={{ color: '#c8ff9f', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', letterSpacing: '0.15em' }}
            >
              Your Light
            </p>

            {/* Trait Name */}
            <h3
              className="text-white font-bold mb-2"
              style={{ fontSize: '20px', fontFamily: 'Satoshi, sans-serif' }}
            >
              {lightTraits[lightIndex].trait}
            </h3>

            {/* Tagline */}
            <p
              style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: 1.6, color: 'rgba(255, 255, 255, 0.7)' }}
            >
              {lightTraits[lightIndex].tagline}
            </p>

          </div>
        </motion.div>
      </div>

      {/* Tap hint below card - only when not revealed */}
      {!shadowRevealed && (
        <div className="flex justify-center mt-4">
          <motion.p
            className="text-white/50 uppercase flex items-center gap-2"
            style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <img src="/hand.png" alt="" className="w-4 h-4 opacity-70" />
            <span>Tap to reveal</span>
          </motion.p>
        </div>
      )}

      {/* After reveal: midnight reset text + share button */}
      <AnimatePresence>
        {shadowRevealed && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="mt-6 space-y-4"
          >
            {/* Midnight reset text */}
            <p
              className="text-center flex items-center justify-center gap-2"
              style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255,255,255,0.3)' }}
            >
              <RefreshCw size={12} />
              COME TOMORROW FOR NEW TRUTHS
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Section>
  );
}

// ===== SOUL RARITY SECTION =====
function SoulRaritySection({ isLocked = false, onUnlockClick }: { isLocked?: boolean; onUnlockClick?: () => void }) {
  const topPercentage = 2; // Mock data - Top 2% means rarer than 98%
  const city = "New York";

  return (
    <Section className="pt-24 px-5">
      <SectionHeader label="Soul Ranking" title="How Rare You Are" />

      {/* Card wrapper with blur if locked - overflow hidden to contain blur */}
      <div className="relative" style={{ borderRadius: '28px', clipPath: 'inset(0 round 28px)', WebkitClipPath: 'inset(0 round 28px)' }}>
        {isLocked && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center cursor-pointer"
            onClick={() => {
              haptics.medium();
              onUnlockClick?.();
            }}
          >
            <div
              className="flex flex-col items-center gap-3 px-8 py-5 rounded-2xl"
              style={{
                background: 'rgba(139, 92, 246, 0.2)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <Lock className="w-6 h-6 text-purple-300" />
              <span
                className="text-white font-semibold"
                style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                Unlock with Premium
              </span>
            </div>
          </div>
        )}

      <motion.div
        className="rounded-[28px] p-6 relative overflow-hidden"
        style={{
          backgroundColor: '#111111',
          minHeight: '240px',
          boxShadow: isLocked ? 'none' : '0 0 40px rgba(167, 139, 250, 0.1), 0 0 80px rgba(167, 139, 250, 0.05)',
          filter: isLocked ? 'blur(12px)' : 'none',
          pointerEvents: isLocked ? 'none' : 'auto',
        }}
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        {/* Background Image */}
        <img
          src="/Screenshot 2026-02-asd212555(1).png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Dark gradient overlay - ends at 100% black to blend with background */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.6) 70%, rgba(17,17,17,1) 100%)',
          }}
        />
        {/* Border frame overlay to cover edge glitch */}
        <div
          className="absolute inset-0 rounded-[28px] pointer-events-none z-50"
          style={{
            boxShadow: 'inset 0 0 0 1px #111111',
          }}
        />

        {/* Content container - centered */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6">
          <motion.p
            className="font-bold text-white"
            style={{ fontSize: '26px', fontFamily: 'Satoshi, sans-serif', lineHeight: 1 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            Top {topPercentage}%
          </motion.p>
          <p
            className="mt-3"
            style={{
              fontSize: '15px',
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
              color: 'rgba(255, 255, 255, 0.6)',
              lineHeight: 1.5
            }}
          >
            Your Soul is rarer than {100 - topPercentage}% of girls in {city}
          </p>

          {/* Progress bar */}
          <div className="mt-5 w-full">
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: 'rgba(255, 255, 255, 0.15)' }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.9), rgba(255,255,255,0.6))' }}
                initial={{ width: 0 }}
                whileInView={{ width: `${100 - topPercentage}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1, delay: 0.3 }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>Common</span>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>Ultra Rare</span>
            </div>
          </div>
        </div>
      </motion.div>
      </div>
    </Section>
  );
}

// ===== THE SOUL YOU ATTRACT SECTION =====
function TypeYouAttractSection({ isLocked = false, onUnlockClick }: { isLocked?: boolean; onUnlockClick?: () => void }) {
  const [isFlipped, setIsFlipped] = useState(false);

  // Mock data
  const attractedType = {
    archetype: "The Emotionally Unavailable",
    traits: ["Hot & Cold", "Mixed Signals", "Avoidant"],
    why: "Your nurturing energy draws those who need healing but can't receive it. You see potential where others see red flags.",
    description: "The ones who keep you guessing, never fully committing but never fully leaving either.",
    imageUrl: '/Adobe Exsdfprsdsdsdsdsdess - file 1 (3).png',
  };

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
    haptics.medium();
  };

  return (
    <Section className="pt-24 px-5">
      <SectionHeader label="Pattern Alert" title="The Soul You Attract" />

      {/* Card wrapper with blur if locked - overflow hidden to contain blur */}
      <div className="relative" style={{ borderRadius: '28px', clipPath: 'inset(0 round 28px)', WebkitClipPath: 'inset(0 round 28px)' }}>
        {isLocked && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center cursor-pointer"
            onClick={() => {
              haptics.medium();
              onUnlockClick?.();
            }}
          >
            <div
              className="flex flex-col items-center gap-3 px-8 py-5 rounded-2xl"
              style={{
                background: 'rgba(139, 92, 246, 0.2)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <Lock className="w-6 h-6 text-purple-300" />
              <span
                className="text-white font-semibold"
                style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                Unlock with Premium
              </span>
            </div>
          </div>
        )}

      {/* Flippable Card Container - matching HIS SOUL TYPE structure */}
      <div
        className="relative w-full cursor-pointer"
        style={{
          perspective: '1000px',
          aspectRatio: '9/16',
          filter: isLocked ? 'blur(12px)' : 'none',
          pointerEvents: isLocked ? 'none' : 'auto',
        }}
        onClick={handleFlip}
      >
        <motion.div
          className="relative w-full h-full"
          style={{ transformStyle: 'preserve-3d' }}
          initial={false}
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* FRONT SIDE - matching HIS SOUL TYPE styling */}
          <div
            className="absolute inset-0 rounded-[28px] overflow-hidden"
            style={{
              backgroundColor: '#111111',
              backfaceVisibility: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
          >
            {/* Full vertical archetype image/video */}
            <SoulTypeMedia
              src={attractedType.imageUrl}
              alt={attractedType.archetype}
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Gradient overlay for text readability */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.8) 100%)',
              }}
            />

            {/* Glassmorphism blur layer - extended outside card bounds to cover edge glitches */}
            <div
              style={{
                position: 'absolute',
                bottom: '-2px',
                left: '-2px',
                right: '-2px',
                height: 'calc(45% + 2px)',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.35) 40%, rgba(0, 0, 0, 0.35) 100%)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
              }}
            />

            {/* Content layer - ABOVE blur, matching HIS SOUL TYPE styling */}
            <div
              className="absolute left-0 right-0 bottom-0 px-6 pb-[40px] flex flex-col items-center text-center"
              style={{ zIndex: 10 }}
            >
              {/* Archetype Title - WHITE like HIS SOUL TYPE */}
              <h3
                style={{ fontSize: '32px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', lineHeight: '1.3', color: '#FFFFFF' }}
              >
                {attractedType.archetype}
              </h3>

              {/* Description */}
              <p
                className="mt-2 max-w-[280px]"
                style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.7)' }}
              >
                {attractedType.description}
              </p>

              {/* Trait Pills - matching HIS SOUL TYPE standard */}
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {(() => {
                  let twoWordUsed = false;
                  return attractedType.traits.map((trait, i) => {
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
                        key={i}
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
              </div>

            </div>
          </div>

          {/* BACK SIDE - matching HIS SOUL TYPE back styling */}
          <div
            className="absolute inset-0 rounded-[28px] overflow-hidden flex flex-col justify-center"
            style={{
              backgroundColor: '#111111',
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
          >
            {/* Mirrored background image/video */}
            <SoulTypeMedia
              src={attractedType.imageUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Glassmorphism overlay */}
            <div
              className="absolute inset-0"
              style={{
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
              }}
            />

            {/* Black overlay 50% */}
            <div
              className="absolute inset-0"
              style={{
                background: 'rgba(0, 0, 0, 0.5)',
              }}
            />

            <motion.div
              className="flex flex-col justify-center h-full relative z-10"
              initial={{ opacity: 0, filter: 'blur(8px)' }}
              animate={{
                opacity: isFlipped ? 1 : 0,
                filter: isFlipped ? 'blur(0px)' : 'blur(8px)'
              }}
              transition={{ duration: 0.3, delay: isFlipped ? 0.4 : 0 }}
            >
              {/* Why This Happens Section */}
              <div className="px-8 flex flex-col items-center text-center">
                <p
                  className="mb-4 font-bold"
                  style={{
                    fontSize: '22px',
                    fontFamily: 'Satoshi, sans-serif',
                    color: '#ffffff',
                  }}
                >
                  Why This Happens
                </p>
                <p
                  className="text-white/70"
                  style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                >
                  {attractedType.why}
                </p>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
      </div>

      {/* Tap hint below card */}
      <div className="flex justify-center mt-4">
        <motion.p
          className="text-white/50 uppercase flex items-center gap-2"
          style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <img src="/hand.png" alt="" className="w-4 h-4 opacity-70" />
          <span>Tap to {isFlipped ? 'flip back' : 'see why'}</span>
        </motion.p>
      </div>
    </Section>
  );
}

// ===== SOUL COMPATIBILITY SECTION =====
function SoulCompatibilitySection({ isLocked = false, onUnlockClick }: { isLocked?: boolean; onUnlockClick?: () => void }) {
  const [stackOrder, setStackOrder] = useState<number[]>([2, 1, 0]); // Bottom to top
  const [flippedCards, setFlippedCards] = useState<boolean[]>([false, false, false]);

  const compatibilities = [
    {
      type: 'most',
      label: 'Most Compatible',
      archetype: 'The Secure One',
      percentage: 94,
      reason: 'Grounds your intensity with stability',
      description: 'This type provides the emotional safety you crave. They show up consistently, communicate clearly, and make you feel seen without the chaos.',
      color: '#99c379',
      imageUrl: '/Adobe Express - file 1 (5) (1).png',
      tag: 'SAFE',
    },
    {
      type: 'least',
      label: 'Least Compatible',
      archetype: 'The Avoidant',
      percentage: 23,
      reason: 'Triggers your anxious attachment',
      description: 'Their emotional distance activates your worst patterns. You chase, they pull away. The cycle repeats until you\'re exhausted.',
      color: '#d07070',
      imageUrl: '/Adobe Express - file 1 (4).png',
      tag: 'RED FLAG',
    },
    {
      type: 'surprising',
      label: 'Surprising Match',
      archetype: 'The Free Spirit',
      percentage: 78,
      reason: 'Teaches you to let go of control',
      description: 'Against all odds, this unpredictable type helps you grow. Their spontaneity challenges your need for certainty in a healthy way.',
      color: '#c78ce7',
      imageUrl: '/Adobe Edsdxpress - file 1 (3).png',
      tag: 'WILD CARD',
    },
  ];

  const moveTopToBottom = () => {
    haptics.light();
    setStackOrder((prev) => {
      const newOrder = [...prev];
      const top = newOrder.pop()!;
      newOrder.unshift(top);
      return newOrder;
    });
    // Reset flip state when card moves
    setFlippedCards([false, false, false]);
  };

  const toggleCardFlip = (cardIndex: number) => {
    haptics.medium();
    setFlippedCards((prev) => {
      const newFlipped = [...prev];
      newFlipped[cardIndex] = !newFlipped[cardIndex];
      return newFlipped;
    });
  };

  const orderedCards = stackOrder.map(index => ({ ...compatibilities[index], originalIndex: index }));

  return (
    <Section className="pt-24 px-5">
      {/* Header */}
      <div className="text-center mb-8">
        <p
          className="text-white/50 uppercase mb-2"
          style={{ fontSize: '16px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
        >
          Love Match
        </p>
        <h2
          className="text-white text-3xl"
          style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
        >
          Soul Compatibility
        </h2>
      </div>

      {/* Card Stack */}
      <div className="relative w-full max-w-[300px] mx-auto pb-16" style={{ aspectRatio: '9/16' }}>
        <AnimatePresence initial={false}>
          {orderedCards.map((item, visualIndex) => {
            const isTop = visualIndex === orderedCards.length - 1;
            const rotation = isTop ? 0 : (visualIndex - 1) * 6;
            const translateY = visualIndex * 12;
            const isFlipped = flippedCards[item.originalIndex];

            return (
              <div
                key={item.type}
                className="absolute inset-0"
                style={{
                  zIndex: visualIndex,
                  perspective: '1000px',
                  transform: `translateY(${translateY}px)`,
                }}
              >
                <motion.div
                  className={`w-full h-full ${isTop ? 'cursor-pointer' : ''}`}
                  initial={false}
                  animate={{
                    rotate: rotation,
                    scale: isTop ? 1.05 : 1,
                  }}
                  drag={isTop}
                  dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  dragElastic={0.9}
                  onDragEnd={(e, { offset, velocity }) => {
                    const swipeThreshold = 80;
                    const swipeVelocityThreshold = 400;
                    const totalOffset = Math.sqrt(offset.x ** 2 + offset.y ** 2);
                    const totalVelocity = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);

                    if (totalOffset > swipeThreshold || totalVelocity > swipeVelocityThreshold) {
                      moveTopToBottom();
                    }
                  }}
                  onClick={() => {
                    if (isTop) {
                      toggleCardFlip(item.originalIndex);
                    }
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 260,
                    damping: 25,
                    delay: visualIndex * 0.05,
                  }}
                >
                  <motion.div
                    className="relative w-full h-full"
                    style={{ transformStyle: 'preserve-3d' }}
                    initial={false}
                    animate={{ rotateY: isFlipped ? 180 : 0 }}
                    transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                  >
                    {/* Front of Card - Image with glassmorphism */}
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundColor: '#111111',
                        backfaceVisibility: 'hidden',
                        transform: 'rotateY(0deg)',
                        borderRadius: '28px',
                        clipPath: 'inset(0 round 28px)',
                        WebkitClipPath: 'inset(0 round 28px)',
                      }}
                    >
                      {/* Lock overlay on each card */}
                      {isLocked && (
                        <div
                          className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-[28px]"
                          style={{
                            background: 'rgba(0, 0, 0, 0.5)',
                            backdropFilter: 'blur(8px)',
                          }}
                          onClick={(e) => { e.stopPropagation(); haptics.medium(); onUnlockClick?.(); }}
                        >
                          <button
                            className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl transition-all active:scale-95"
                            style={{
                              background: 'rgba(139, 92, 246, 0.25)',
                              border: '1px solid rgba(139, 92, 246, 0.5)',
                            }}
                          >
                            <Lock className="w-5 h-5 text-purple-300" />
                            <span className="text-white" style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                              Unlock with Premium
                            </span>
                          </button>
                        </div>
                      )}
                      {/* Background Image/Video */}
                      <SoulTypeMedia
                        src={item.imageUrl}
                        alt={item.archetype}
                        className="absolute inset-0 w-full h-full object-cover"
                      />

                      {/* Gradient overlay for text readability - same as THE SOUL YOU ATTRACT */}
                      <div
                        className="absolute inset-0"
                        style={{
                          background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.8) 100%)',
                        }}
                      />

                      {/* Glassmorphism blur layer - same as THE SOUL YOU ATTRACT */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '-2px',
                          left: '-2px',
                          right: '-2px',
                          height: 'calc(60% + 2px)',
                          background: 'linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.35) 40%, rgba(0, 0, 0, 0.35) 100%)',
                          backdropFilter: 'blur(20px)',
                          WebkitBackdropFilter: 'blur(20px)',
                          maskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
                          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
                        }}
                      />

                      {/* Darken non-top cards */}
                      {!isTop && (
                        <div className="absolute inset-0 bg-black/40 rounded-[28px]" />
                      )}

                      {/* Front Content - positioned at bottom */}
                      <div className="absolute bottom-0 left-0 right-0 px-6 pb-8 flex flex-col items-center text-center">
                        {/* Label */}
                        <p
                          className="uppercase tracking-widest mb-2"
                          style={{ fontSize: '12px', letterSpacing: '1.5px', color: item.color, fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
                        >
                          {item.label}
                        </p>

                        {/* Archetype Name - WHITE */}
                        <h3
                          className="font-bold mb-2"
                          style={{ fontSize: '24px', fontFamily: 'Satoshi, sans-serif', color: '#ffffff' }}
                        >
                          {item.archetype}
                        </h3>

                        {/* Short reason */}
                        <p
                          className="text-white/70 max-w-[220px]"
                          style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: 1.5 }}
                        >
                          {item.reason}
                        </p>

                        {/* Percentage badge */}
                        <div
                          className="mt-4 px-4 py-1.5 rounded-full"
                          style={{
                            background: 'rgba(255,255,255,0.1)',
                          }}
                        >
                          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.8)', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 700, letterSpacing: '1.5px' }}>
                            {item.percentage}% MATCH
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Back of Card - Image with glassmorphism */}
                    <div
                      className="absolute inset-0 rounded-[28px] overflow-hidden"
                      style={{
                        backgroundColor: '#111111',
                        backfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                      }}
                    >
                      {/* Background image/video - blurred for glassmorphism effect */}
                      <SoulTypeMedia
                        src={item.imageUrl}
                        alt={item.archetype}
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

                      {/* Dark gradient layer - darker at bottom - STRONG */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '-2px',
                          left: '-2px',
                          right: '-2px',
                          height: 'calc(78% + 2px)',
                          background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.6) 60%, rgba(0,0,0,0.85) 100%)',
                        }}
                      />

                      {/* Back Content - centered */}
                      <motion.div
                        className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: isFlipped ? 1 : 0 }}
                        transition={{ duration: 0.3, delay: isFlipped ? 0.4 : 0 }}
                      >
                        {/* Why label */}
                        <p
                          className="mb-4 font-bold"
                          style={{
                            fontSize: '22px',
                            fontFamily: 'Satoshi, sans-serif',
                            color: '#ffffff',
                          }}
                        >
                          Why?
                        </p>

                        {/* Description */}
                        <p
                          className="text-white/80 max-w-[240px]"
                          style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: 1.6 }}
                        >
                          {item.description}
                        </p>
                      </motion.div>
                    </div>
                  </motion.div>
                </motion.div>
              </div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Tap and Swipe hints below cards */}
      <div className="flex justify-center gap-6" style={{ marginTop: '55px' }}>
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <img src="/hand.png" alt="" className="w-5 h-5 opacity-70" />
          <span className="text-white/50 uppercase" style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            Tap the card
          </span>
        </motion.div>
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
        >
          <img src="/hand%20(1).png" alt="" className="w-5 h-5 opacity-70" />
          <span className="text-white/50 uppercase" style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            Swipe the card
          </span>
        </motion.div>
      </div>
    </Section>
  );
}

// ===== MISTAKES SECTION =====
function MistakesSection({ isLocked = false, onUnlockClick }: { isLocked?: boolean; onUnlockClick?: () => void }) {
  const [flippedCards, setFlippedCards] = useState<boolean[]>([false, false, false]);
  const [stackOrder, setStackOrder] = useState<number[]>([2, 1, 0]); // Bottom to top
  const isDraggingRef = useRef(false);
  const dragDistanceRef = useRef(0);

  const mistakes = [
    {
      title: "Responding too fast",
      description: "You reply in seconds. He replies in hours. The pattern is clear.",
      frequency: "In 4 out of 5 conversations",
      why: "You confuse availability with value. Being instantly reachable feels like showing love, but it signals desperation.",
      image: "/openart-7b0893c9-4dab-4ef0-af7a-03e2aa060c71.jpg",
    },
    {
      title: "Ignoring the first red flag",
      description: "You saw it. You felt it. You explained it away anyway.",
      frequency: "Every single time",
      why: "Hope is addictive. You'd rather believe the exception than accept the pattern.",
      image: "/openart-7b0893c9-4dab-4efasdads0-af7a-03e2aa060c71.jpg",
    },
    {
      title: "Over-explaining yourself",
      description: "When a simple 'no' would do, you write paragraphs hoping he'll understand.",
      frequency: "In 3 out of 5 conversations",
      why: "You think if you explain well enough, he'll finally get it. But he already understands—he just doesn't care.",
      image: "/openart-7b0893c9-4dab-4asdasdef0-af7a-03e2aa060c71(3).jpg",
    },
  ];

  const handleFlip = (cardIndex: number) => {
    // Only flip if it wasn't a drag
    if (dragDistanceRef.current < 10) {
      setFlippedCards(prev => {
        const newState = [...prev];
        newState[cardIndex] = !newState[cardIndex];
        return newState;
      });
      haptics.medium();
    }
  };

  const moveTopToBottom = () => {
    setStackOrder(prev => {
      const newOrder = [...prev];
      const top = newOrder.pop()!;
      newOrder.unshift(top);
      return newOrder;
    });
    // Reset flip state when card moves
    setFlippedCards([false, false, false]);
  };

  const orderedMistakes = stackOrder.map(index => ({ ...mistakes[index], originalIndex: index }));

  return (
    <Section className="pt-24 px-5">
      <SectionHeader label="Pattern Recognition" title="Mistakes You Keep Making" />

      {/* Card Deck Container */}
      <div className="relative mx-auto" style={{ width: 'calc(100% - 32px)', aspectRatio: '5/4' }}>
        <AnimatePresence initial={false}>
          {orderedMistakes.map((mistake, visualIndex) => {
            const isTop = visualIndex === orderedMistakes.length - 1;
            const rotation = isTop ? 0 : (visualIndex - 1) * 6;
            const translateY = visualIndex * 12;
            const isFlipped = flippedCards[mistake.originalIndex];

            return (
              <motion.div
                key={mistake.originalIndex}
                className="absolute inset-0"
                style={{
                  zIndex: visualIndex,
                  perspective: '1000px',
                }}
                initial={false}
                animate={{
                  rotate: rotation,
                  y: translateY,
                  scale: isTop ? 1.02 : 1,
                }}
                transition={{
                  type: 'spring',
                  stiffness: 260,
                  damping: 25,
                }}
              >
                {/* Draggable wrapper */}
                <motion.div
                  className={`w-full h-full ${isTop ? 'cursor-pointer' : ''}`}
                  drag={isTop}
                  dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  dragElastic={0.9}
                  dragSnapToOrigin={true}
                  onDragStart={() => {
                    isDraggingRef.current = true;
                    dragDistanceRef.current = 0;
                  }}
                  onDrag={(_, info) => {
                    dragDistanceRef.current = Math.sqrt(info.offset.x ** 2 + info.offset.y ** 2);
                  }}
                  onDragEnd={(_, info) => {
                    const threshold = 80;
                    const distance = Math.sqrt(info.offset.x ** 2 + info.offset.y ** 2);
                    if (distance > threshold) {
                      moveTopToBottom();
                      haptics.medium();
                    }
                    setTimeout(() => {
                      isDraggingRef.current = false;
                    }, 100);
                  }}
                  onClick={() => {
                    if (isTop && !isLocked && !isDraggingRef.current) {
                      // Reset drag distance to allow flip on pure tap
                      dragDistanceRef.current = 0;
                      handleFlip(mistake.originalIndex);
                    }
                  }}
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  {/* Lock overlay */}
                  {isLocked && isTop && (
                    <div
                      className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-[20px]"
                      style={{
                        background: 'rgba(0, 0, 0, 0.5)',
                        backdropFilter: 'blur(8px)',
                      }}
                      onClick={(e) => { e.stopPropagation(); haptics.medium(); onUnlockClick?.(); }}
                    >
                      <button
                        className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl transition-all active:scale-95"
                        style={{
                          background: 'rgba(139, 92, 246, 0.25)',
                          border: '1px solid rgba(139, 92, 246, 0.5)',
                        }}
                      >
                        <Lock className="w-5 h-5 text-purple-300" />
                        <span className="text-white" style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                          Unlock with Premium
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Front Card */}
                  <motion.div
                    className="absolute inset-0 rounded-[20px] overflow-hidden"
                    animate={{ rotateY: isFlipped ? 180 : 0 }}
                    transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                    style={{
                      transformStyle: 'preserve-3d',
                      backfaceVisibility: 'hidden',
                      background: '#111111',
                      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
                    }}
                  >
                    {/* Background image - only if exists */}
                    {mistake.image && (
                      <>
                        <img
                          src={mistake.image}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                        />

                        {/* Gradient overlay for text readability - same as THE SOUL YOU ATTRACT */}
                        <div
                          className="absolute inset-0"
                          style={{
                            background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.8) 100%)',
                          }}
                        />

                        {/* Glassmorphism blur layer - same as THE SOUL YOU ATTRACT */}
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '-2px',
                            left: '-2px',
                            right: '-2px',
                            height: 'calc(50% + 2px)',
                            background: 'linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.35) 40%, rgba(0, 0, 0, 0.35) 100%)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            maskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
                            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
                          }}
                        />
                      </>
                    )}

                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-5" style={{ zIndex: 10 }}>
                      {/* Card number circle */}
                      <div
                        className="flex items-center justify-center mb-3"
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: 'rgba(255, 255, 255, 0.2)',
                          backdropFilter: 'blur(20px)',
                          WebkitBackdropFilter: 'blur(20px)',
                        }}
                      >
                        <span
                          className="text-white"
                          style={{
                            fontSize: '14px',
                            fontFamily: 'Satoshi, sans-serif',
                            fontWeight: 600,
                          }}
                        >
                          {mistake.originalIndex + 1}
                        </span>
                      </div>
                      <h4
                        className="text-white font-bold mb-2"
                        style={{
                          fontSize: '18px',
                          fontFamily: 'Satoshi, sans-serif',
                        }}
                      >
                        {mistake.title}
                      </h4>
                      <p
                        className="text-white/70 mb-3"
                        style={{
                          fontSize: '13px',
                          fontFamily: 'Plus Jakarta Sans, sans-serif',
                          fontWeight: 200,
                          letterSpacing: '1.5px',
                          lineHeight: 1.4,
                          maxWidth: '85%',
                        }}
                      >
                        {mistake.description}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: '#ff9f9f', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                      >
                        {mistake.frequency}
                      </p>
                    </div>
                  </motion.div>

                  {/* Back Card */}
                  <motion.div
                    className="absolute inset-0 rounded-[20px] overflow-hidden"
                    animate={{ rotateY: isFlipped ? 0 : -180 }}
                    transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                    style={{
                      transformStyle: 'preserve-3d',
                      backfaceVisibility: 'hidden',
                      background: '#111111',
                      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
                    }}
                  >
                    {/* Background image - only if exists */}
                    {mistake.image && (
                      <>
                        <img
                          src={mistake.image}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                        />

                        {/* Non-gradient dark layer */}
                        <div
                          className="absolute inset-0"
                          style={{
                            background: 'rgba(0, 0, 0, 0.4)',
                          }}
                        />

                        {/* Glassmorphism layer covering entire back */}
                        <div
                          className="absolute inset-0"
                          style={{
                            background: 'rgba(0, 0, 0, 0.35)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                          }}
                        />
                      </>
                    )}

                    <motion.div
                      className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center"
                      style={{ zIndex: 10 }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: isFlipped ? 1 : 0 }}
                      transition={{ duration: 0.3, delay: isFlipped ? 0.2 : 0 }}
                    >
                      <p
                        className="mb-4 font-bold"
                        style={{
                          fontSize: '18px',
                          fontFamily: 'Satoshi, sans-serif',
                          color: '#ffffff',
                        }}
                      >
                        Why You Do This
                      </p>

                      <p
                        className="text-white/90"
                        style={{
                          fontSize: '15px',
                          fontFamily: 'Plus Jakarta Sans, sans-serif',
                          fontWeight: 200,
                          letterSpacing: '1.5px',
                          lineHeight: 1.6,
                          maxWidth: '280px',
                        }}
                      >
                        {mistake.why}
                      </p>
                    </motion.div>
                  </motion.div>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Hints with icons */}
      <div className="flex justify-center items-center gap-6" style={{ marginTop: '48px' }}>
        <div className="flex items-center gap-2">
          <img src="/hand.png" alt="" className="w-4 h-4 opacity-30" />
          <p
            className="text-white/30 uppercase"
            style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
          >
            Tap to see why
          </p>
        </div>
        <div className="flex items-center gap-2">
          <img src="/hand (2).png" alt="" className="w-4 h-4 opacity-30" />
          <p
            className="text-white/30 uppercase"
            style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
          >
            Swipe the card
          </p>
        </div>
      </div>
    </Section>
  );
}

// ===== YOU ARE BECOMING SECTION =====
// Golden accent for future archetype
const FUTURE_ARCHETYPE_ACCENT = '#d4af37';
// Dev: hardcoded image for future archetype
const DEV_FUTURE_ARCHETYPE_IMAGE = '/Adobe Expreasdss - file 1 (3).png';

function YouAreBecomingSection({ isLocked = false, onUnlockClick }: { isLocked?: boolean; onUnlockClick?: () => void }) {
  // Mock data for future self
  const futureArchetype = {
    title: "The Crown",
    tagline: "You know your worth — and so does everyone else",
    traits: ["Self-assured", "Boundary Queen", "High Standards"],
  };

  return (
    <Section className="px-5 relative" style={{ marginTop: '45px' }}>
      <SectionHeader label="Future Vision" title="You Are Becoming" />

      {/* The Card - Full vertical image with sfumato overlay (same as YourArchetypeSection) */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="rounded-[28px] overflow-hidden relative"
        style={{
          aspectRatio: '9/16',
          backgroundColor: '#111111',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          filter: isLocked ? 'blur(12px)' : 'none',
        }}
      >
        {/* Full vertical archetype image */}
        <img
          src={DEV_FUTURE_ARCHETYPE_IMAGE}
          alt={futureArchetype.title}
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Gradient overlay for text readability */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.6) 100%)',
          }}
        />

        {/* Noise/Grain overlay */}
        <NoiseOverlay />

        {/* Glassmorphism background layer (with mask fade) - extended outside card bounds to cover edge glitches */}
        <div
          style={{
            position: 'absolute',
            bottom: '-2px',
            left: '-2px',
            right: '-2px',
            height: 'calc(55% + 2px)',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.35) 40%, rgba(0, 0, 0, 0.35) 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 40%, black 100%)',
          }}
        />

        {/* Content layer (not affected by mask) */}
        <div
          className="absolute bottom-0 left-0 right-0 px-6 pb-[40px] flex flex-col items-center text-center"
        >
          {/* Archetype Title (HERO) */}
          <h3
            className="font-bold"
            style={{ fontSize: '26px', fontFamily: 'Satoshi, sans-serif', lineHeight: '1.3', color: '#FFFFFF' }}
          >
            {futureArchetype.title}
          </h3>

          {/* Description - 2-3 lines */}
          <p
            className="text-white/70 mt-2 max-w-[280px]"
            style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: '1.6' }}
          >
            {futureArchetype.tagline}
          </p>

          {/* Trait Pills - matching HIS SOUL TYPE standard */}
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {(() => {
              let twoWordUsed = false;
              return futureArchetype.traits.map((trait, i) => {
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
                    key={i}
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
          </div>
        </div>
      </motion.div>

      {/* Lock overlay */}
      {isLocked && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center cursor-pointer"
          style={{ top: '60px' }}
          onClick={() => {
            onUnlockClick?.();
          }}
        >
          <div
            className="flex flex-col items-center gap-3 px-8 py-5 rounded-2xl"
            style={{
              background: 'rgba(139, 92, 246, 0.2)',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <Lock className="w-6 h-6 text-purple-300" />
            <span
              className="text-white font-semibold"
              style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Unlock with Premium
            </span>
          </div>
        </div>
      )}
    </Section>
  );
}

// ===== Empty State =====

function EmptyStateZero() {
  return (
    <div className="min-h-screen bg-black px-5 pt-14 pb-24">
      <div className="flex flex-col items-center justify-center mt-20 text-center">
        {/* Icon */}
        <motion.div
          className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        >
          <Diamond size={36} className="text-white/30" />
        </motion.div>

        {/* Title */}
        <motion.h1
          className="text-white text-2xl font-bold mb-3"
          style={{ fontFamily: 'Satoshi, sans-serif' }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          Your Soul Awaits
        </motion.h1>

        {/* Description */}
        <motion.p
          className="text-white/50 text-base mb-8 max-w-[260px]"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: 1.5 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          Upload your first chat to discover who you really are in relationships.
        </motion.p>

        {/* CTA Button */}
        <motion.button
          className="px-6 py-3 rounded-full flex items-center gap-2"
          style={{
            background: 'linear-gradient(135deg, #3d2a6b, #1a1233)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          whileTap={{ scale: 0.98 }}
        >
          <Upload size={18} className="text-white/70" />
          <span
            className="text-white font-medium"
            style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            Start Your First Analysis
          </span>
        </motion.button>
      </div>
    </div>
  );
}

// ===== SETTINGS BOTTOM SHEET =====
interface SettingsBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userData: {
    name: string;
    avatar: string;
    archetype: string;
    isPremium: boolean;
  };
}

interface SettingsItemProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  rightElement?: React.ReactNode;
  danger?: boolean;
}

function SettingsItem({ icon, label, onClick, rightElement, danger }: SettingsItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between py-3.5 px-4 active:bg-white/5 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span style={{ color: danger ? '#ef4444' : 'rgba(255, 255, 255, 0.5)' }}>
          {icon}
        </span>
        <span
          style={{
            fontSize: '15px',
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
            color: danger ? '#ef4444' : 'rgba(255, 255, 255, 0.9)',
          }}
        >
          {label}
        </span>
      </div>
      {rightElement && <span>{rightElement}</span>}
    </button>
  );
}

function SettingsDivider() {
  return <div className="h-px bg-white/5 mx-4" />;
}

function SettingsSectionHeader({ title }: { title: string }) {
  return (
    <p
      className="px-4 pt-5 pb-2 uppercase tracking-wider"
      style={{
        fontSize: '11px',
        fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
        color: 'rgba(255, 255, 255, 0.35)',
        letterSpacing: '0.08em',
      }}
    >
      {title}
    </p>
  );
}

interface NotificationSettings {
  dailyTruths: boolean;
  analysisComplete: boolean;
  soulUpdates: boolean;
}

function SettingsBottomSheet({ isOpen, onClose, userData }: SettingsBottomSheetProps) {
  // Load notifications from localStorage
  const [notifications, setNotifications] = useState<NotificationSettings>(() => {
    const saved = localStorage.getItem('toxicornah_notifications');
    if (saved) {
      try {
        return JSON.parse(saved) as NotificationSettings;
      } catch {
        return { dailyTruths: true, analysisComplete: true, soulUpdates: false };
      }
    }
    return { dailyTruths: true, analysisComplete: true, soulUpdates: false };
  });

  const [incognitoMode, setIncognitoMode] = useState(() => {
    return localStorage.getItem('toxicornah_incognito') === 'true';
  });

  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showPrivacyData, setShowPrivacyData] = useState(false);

  // Profile editing state
  const [editName, setEditName] = useState(userData.name);
  const [editAvatar, setEditAvatar] = useState<string | null>(null);

  // Save notifications to localStorage when changed
  useEffect(() => {
    localStorage.setItem('toxicornah_notifications', JSON.stringify(notifications));
  }, [notifications]);

  // Save incognito mode to localStorage
  useEffect(() => {
    localStorage.setItem('toxicornah_incognito', incognitoMode.toString());
  }, [incognitoMode]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const accentColor = '#A855F7';

  // ===== HANDLER FUNCTIONS =====

  const handleManageSubscription = async () => {
    setIsLoading('subscription');
    haptics.light();
    try {
      const { url, error } = await createCustomerPortalSession();
      if (url) {
        window.location.href = url;
      } else if (error) {
        alert('Unable to open subscription management. Please try again.');
      }
    } catch (err) {
      alert('Something went wrong. Please try again.');
    } finally {
      setIsLoading(null);
    }
  };

  const handleRestorePurchases = async () => {
    setIsLoading('restore');
    haptics.light();
    try {
      const { isActive } = await getSubscriptionDetails();
      if (isActive) {
        alert('Your subscription has been restored successfully!');
        window.location.reload();
      } else {
        alert('No active subscription found. If you believe this is an error, please contact support.');
      }
    } catch (err) {
      alert('Unable to restore purchases. Please try again.');
    } finally {
      setIsLoading(null);
    }
  };

  const handleInviteFriends = async () => {
    haptics.light();
    const shareData = {
      title: 'Toxic or Nah?',
      text: 'Find out if your situationship is toxic. Get the truth about your relationship.',
      url: window.location.origin,
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        alert('Link copied to clipboard!');
      }
    } catch (err) {
      // User cancelled or error
      console.log('Share cancelled');
    }
  };

  const handleLeaveReview = () => {
    haptics.light();
    // For web app, open feedback form or app store link
    // This would be configured based on the platform
    window.open('https://forms.gle/your-feedback-form', '_blank');
  };

  const handleHelpCenter = () => {
    haptics.light();
    window.open('https://help.toxicornah.com', '_blank');
  };

  const handleTermsOfService = () => {
    haptics.light();
    window.open('https://toxicornah.com/terms', '_blank');
  };

  const handlePrivacyPolicy = () => {
    haptics.light();
    window.open('https://toxicornah.com/privacy', '_blank');
  };

  const handleLogout = async () => {
    setIsLoading('logout');
    haptics.medium();
    try {
      await supabase.auth.signOut();
      localStorage.removeItem('toxicornah_notifications');
      localStorage.removeItem('toxicornah_incognito');
      window.location.href = '/';
    } catch (err) {
      alert('Failed to log out. Please try again.');
    } finally {
      setIsLoading(null);
      setShowLogoutConfirm(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsLoading('delete');
    haptics.heavy();
    try {
      // Call Supabase function to delete account
      const { error } = await supabase.functions.invoke('delete-account', {});
      if (error) {
        throw error;
      }
      await supabase.auth.signOut();
      localStorage.clear();
      window.location.href = '/';
    } catch (err) {
      alert('Failed to delete account. Please contact support.');
    } finally {
      setIsLoading(null);
      setShowDeleteConfirm(false);
    }
  };

  const handleEditProfile = () => {
    haptics.light();
    setEditName(userData.name);
    setShowEditProfile(true);
  };

  const handleSaveProfile = async () => {
    setIsLoading('profile');
    haptics.medium();
    try {
      // Save to localStorage for now (would save to Supabase in production)
      localStorage.setItem('toxicornah_profile', JSON.stringify({
        name: editName,
        avatar: editAvatar || userData.avatar,
      }));
      // In production, you'd update the user profile in Supabase:
      // await supabase.from('profiles').update({ name: editName, avatar: editAvatar }).eq('id', userId);
      alert('Profile updated successfully!');
      setShowEditProfile(false);
      window.location.reload(); // Refresh to show new profile
    } catch (err) {
      alert('Failed to update profile. Please try again.');
    } finally {
      setIsLoading(null);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePrivacyData = () => {
    haptics.light();
    setShowPrivacyData(true);
  };

  const handleClearHistory = async () => {
    setIsLoading('clearHistory');
    haptics.heavy();
    try {
      // Clear analysis history from localStorage
      localStorage.removeItem('toxicornah_analyses');
      localStorage.removeItem('toxicornah_connections');
      // In production, you'd also clear from Supabase:
      // await supabase.from('analyses').delete().eq('user_id', userId);
      alert('Analysis history cleared successfully!');
      setShowPrivacyData(false);
    } catch (err) {
      alert('Failed to clear history. Please try again.');
    } finally {
      setIsLoading(null);
    }
  };

  const handleDownloadData = async () => {
    setIsLoading('download');
    haptics.light();
    try {
      // Collect all user data
      const data = {
        profile: {
          name: userData.name,
          archetype: userData.archetype,
        },
        notifications: notifications,
        incognitoMode: incognitoMode,
        exportDate: new Date().toISOString(),
      };

      // Create and download JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `toxicornah-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to download data. Please try again.');
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0, 0, 0, 0.6)' }}
            onClick={onClose}
          />

          {/* Bottom Sheet - Draggable to close */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              // Close if dragged down more than 40% of viewport height or with very high velocity
              const threshold = window.innerHeight * 0.4;
              if (info.offset.y > threshold || info.velocity.y > 1200) {
                onClose();
              }
            }}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-[28px] overflow-hidden touch-none"
            style={{
              maxHeight: '85vh',
              background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.06) 0%, rgba(0, 0, 0, 0.92) 100%)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: '0 -4px 30px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
            }}
          >
            {/* Black overlay - same as BottomNav */}
            <div
              className="absolute inset-0 rounded-t-[28px]"
              style={{ background: 'rgba(0, 0, 0, 0.4)', pointerEvents: 'none' }}
            />
            {/* Handle bar - drag indicator */}
            <div className="relative flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing" style={{ zIndex: 1 }}>
              <div
                className="w-12 h-1.5 rounded-full"
                style={{ background: 'rgba(255, 255, 255, 0.3)' }}
              />
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255, 255, 255, 0.1)', zIndex: 2 }}
            >
              <X size={18} style={{ color: 'rgba(255, 255, 255, 0.6)' }} />
            </button>

            {/* Scrollable content */}
            <div
              className="relative overflow-y-auto"
              style={{ maxHeight: 'calc(85vh - 60px)', paddingBottom: 'env(safe-area-inset-bottom, 24px)', zIndex: 1 }}
            >
              {/* ===== HEADER: Profile Identity ===== */}
              <div className="flex flex-col items-center pt-2 pb-6">
                {/* Avatar with halo */}
                <div className="relative mb-3">
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      margin: '-3px',
                      border: `1.5px solid ${accentColor}50`,
                      boxShadow: `0 0 15px ${accentColor}30`,
                    }}
                  />
                  <div
                    className="w-16 h-16 rounded-full overflow-hidden"
                    style={{ border: `2px solid ${accentColor}60` }}
                  >
                    <img
                      src={userData.avatar}
                      alt={userData.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>

                {/* Name */}
                <h3
                  className="text-white font-bold"
                  style={{ fontSize: '18px', fontFamily: 'Satoshi, sans-serif' }}
                >
                  {userData.name}
                </h3>

                {/* Archetype */}
                <p
                  style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: accentColor }}
                >
                  {userData.archetype}
                </p>
              </div>

              <SettingsDivider />

              {/* ===== SECTION: Subscription ===== */}
              <SettingsSectionHeader title="Subscription" />
              <SettingsItem
                icon={<Crown size={20} />}
                label="Subscription Status"
                rightElement={
                  <span
                    className="px-2.5 py-1 rounded-full"
                    style={{
                      fontSize: '11px',
                      fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                      fontWeight: 600,
                      background: userData.isPremium ? 'rgba(212, 175, 55, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                      color: userData.isPremium ? '#d4af37' : 'rgba(255, 255, 255, 0.5)',
                    }}
                  >
                    {userData.isPremium ? 'PREMIUM' : 'FREE'}
                  </span>
                }
              />
              <SettingsItem
                icon={<CreditCard size={20} />}
                label={isLoading === 'subscription' ? 'Opening...' : 'Manage Subscription'}
                rightElement={<ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />}
                onClick={handleManageSubscription}
              />
              <SettingsItem
                icon={<RotateCcw size={20} />}
                label={isLoading === 'restore' ? 'Restoring...' : 'Restore Purchases'}
                onClick={handleRestorePurchases}
              />

              <SettingsDivider />

              {/* ===== SECTION: Notifications ===== */}
              <SettingsSectionHeader title="Notifications" />
              <SettingsItem
                icon={<MessageCircle size={20} />}
                label="Daily Truths"
                rightElement={
                  <NotificationToggle
                    enabled={notifications.dailyTruths}
                    onChange={(v) => setNotifications(prev => ({ ...prev, dailyTruths: v }))}
                  />
                }
              />
              <SettingsItem
                icon={<Bell size={20} />}
                label="Analysis Complete"
                rightElement={
                  <NotificationToggle
                    enabled={notifications.analysisComplete}
                    onChange={(v) => setNotifications(prev => ({ ...prev, analysisComplete: v }))}
                  />
                }
              />
              <SettingsItem
                icon={<Sparkles size={20} />}
                label="Soul Updates"
                rightElement={
                  <NotificationToggle
                    enabled={notifications.soulUpdates}
                    onChange={(v) => setNotifications(prev => ({ ...prev, soulUpdates: v }))}
                  />
                }
              />

              <SettingsDivider />

              {/* ===== SECTION: Account & Privacy ===== */}
              <SettingsSectionHeader title="Account & Privacy" />
              <SettingsItem
                icon={<User size={20} />}
                label="Edit Profile"
                rightElement={<ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />}
                onClick={handleEditProfile}
              />
              <SettingsItem
                icon={<Shield size={20} />}
                label="Privacy & Data"
                rightElement={<ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />}
                onClick={handlePrivacyData}
              />
              <SettingsItem
                icon={<UserX size={20} />}
                label="Incognito Mode"
                rightElement={
                  <NotificationToggle
                    enabled={incognitoMode}
                    onChange={(v) => setIncognitoMode(v)}
                  />
                }
              />

              <SettingsDivider />

              {/* ===== SECTION: Community & Support ===== */}
              <SettingsSectionHeader title="Community & Support" />
              <SettingsItem
                icon={<Users size={20} />}
                label="Invite Friends"
                rightElement={<ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />}
                onClick={handleInviteFriends}
              />
              <SettingsItem
                icon={<Star size={20} />}
                label="Leave a Review"
                rightElement={<ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />}
                onClick={handleLeaveReview}
              />
              <SettingsItem
                icon={<HelpCircle size={20} />}
                label="Help Center"
                rightElement={<ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />}
                onClick={handleHelpCenter}
              />

              <SettingsDivider />

              {/* ===== SECTION: Legal & Exit ===== */}
              <SettingsSectionHeader title="Legal" />
              <SettingsItem
                icon={<FileText size={20} />}
                label="Terms of Service"
                rightElement={<ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />}
                onClick={handleTermsOfService}
              />
              <SettingsItem
                icon={<Shield size={20} />}
                label="Privacy Policy"
                rightElement={<ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />}
                onClick={handlePrivacyPolicy}
              />

              <div className="h-4" />

              <SettingsItem
                icon={<LogOut size={20} />}
                label={isLoading === 'logout' ? 'Logging out...' : 'Log Out'}
                danger
                onClick={() => setShowLogoutConfirm(true)}
              />

              <div className="h-2" />

              <SettingsItem
                icon={<Trash2 size={20} />}
                label={isLoading === 'delete' ? 'Deleting...' : 'Delete Account'}
                danger
                onClick={() => setShowDeleteConfirm(true)}
              />

              <div className="h-8" />

              {/* Logout Confirmation Dialog */}
              <AnimatePresence>
                {showLogoutConfirm && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] flex items-center justify-center px-6"
                    style={{ background: 'rgba(0, 0, 0, 0.8)' }}
                    onClick={() => setShowLogoutConfirm(false)}
                  >
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="w-full max-w-sm rounded-2xl overflow-hidden"
                      style={{ background: '#1a1a1a', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-6 text-center">
                        <LogOut size={32} className="mx-auto mb-3 text-white/60" />
                        <h3 className="text-white text-lg mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                          Log Out?
                        </h3>
                        <p className="text-white/50 text-sm mb-6" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                          Are you sure you want to log out of your account?
                        </p>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setShowLogoutConfirm(false)}
                            className="flex-1 py-3 rounded-xl text-white/70 font-medium"
                            style={{ background: 'rgba(255, 255, 255, 0.1)', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleLogout}
                            disabled={isLoading === 'logout'}
                            className="flex-1 py-3 rounded-xl text-white font-medium"
                            style={{ background: '#ef4444', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                          >
                            {isLoading === 'logout' ? 'Logging out...' : 'Log Out'}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Delete Account Confirmation Dialog */}
              <AnimatePresence>
                {showDeleteConfirm && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] flex items-center justify-center px-6"
                    style={{ background: 'rgba(0, 0, 0, 0.8)' }}
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="w-full max-w-sm rounded-2xl overflow-hidden"
                      style={{ background: '#1a1a1a', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-6 text-center">
                        <Trash2 size={32} className="mx-auto mb-3 text-red-500" />
                        <h3 className="text-white text-lg mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                          Delete Account?
                        </h3>
                        <p className="text-white/50 text-sm mb-6" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                          This action cannot be undone. All your data, analyses, and subscription will be permanently deleted.
                        </p>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setShowDeleteConfirm(false)}
                            className="flex-1 py-3 rounded-xl text-white/70 font-medium"
                            style={{ background: 'rgba(255, 255, 255, 0.1)', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleDeleteAccount}
                            disabled={isLoading === 'delete'}
                            className="flex-1 py-3 rounded-xl text-white font-medium"
                            style={{ background: '#ef4444', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                          >
                            {isLoading === 'delete' ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Edit Profile Modal */}
              <AnimatePresence>
                {showEditProfile && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] flex items-center justify-center px-6"
                    style={{ background: 'rgba(0, 0, 0, 0.8)' }}
                    onClick={() => setShowEditProfile(false)}
                  >
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="w-full max-w-sm rounded-2xl overflow-hidden"
                      style={{ background: '#1a1a1a', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-6">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-white text-lg" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                            Edit Profile
                          </h3>
                          <button
                            onClick={() => setShowEditProfile(false)}
                            className="w-8 h-8 rounded-full flex items-center justify-center"
                            style={{ background: 'rgba(255, 255, 255, 0.1)' }}
                          >
                            <X size={18} style={{ color: 'rgba(255, 255, 255, 0.6)' }} />
                          </button>
                        </div>

                        {/* Avatar */}
                        <div className="flex flex-col items-center mb-6">
                          <label className="relative cursor-pointer group">
                            <div
                              className="w-20 h-20 rounded-full overflow-hidden border-2"
                              style={{ borderColor: accentColor }}
                            >
                              <img
                                src={editAvatar || userData.avatar}
                                alt="Avatar"
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div
                              className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ background: 'rgba(0, 0, 0, 0.6)' }}
                            >
                              <Upload size={24} className="text-white" />
                            </div>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleAvatarChange}
                              className="hidden"
                            />
                          </label>
                          <p className="text-white/40 text-xs mt-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                            Tap to change photo
                          </p>
                        </div>

                        {/* Name Input */}
                        <div className="mb-6">
                          <label className="block text-white/50 text-xs mb-2 uppercase tracking-wider" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                            Name
                          </label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl text-white outline-none transition-colors"
                            style={{
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                            }}
                            placeholder="Enter your name"
                          />
                        </div>

                        {/* Save Button */}
                        <button
                          onClick={handleSaveProfile}
                          disabled={isLoading === 'profile' || !editName.trim()}
                          className="w-full py-3 rounded-xl text-white font-medium disabled:opacity-50"
                          style={{ background: accentColor, fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                        >
                          {isLoading === 'profile' ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Privacy & Data Modal */}
              <AnimatePresence>
                {showPrivacyData && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] flex items-center justify-center px-6"
                    style={{ background: 'rgba(0, 0, 0, 0.8)' }}
                    onClick={() => setShowPrivacyData(false)}
                  >
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="w-full max-w-sm rounded-2xl overflow-hidden"
                      style={{ background: '#1a1a1a', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-6">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-white text-lg" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                            Privacy & Data
                          </h3>
                          <button
                            onClick={() => setShowPrivacyData(false)}
                            className="w-8 h-8 rounded-full flex items-center justify-center"
                            style={{ background: 'rgba(255, 255, 255, 0.1)' }}
                          >
                            <X size={18} style={{ color: 'rgba(255, 255, 255, 0.6)' }} />
                          </button>
                        </div>

                        {/* Description */}
                        <p className="text-white/50 text-sm mb-6" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                          Manage your data and privacy settings. Your data is stored securely and never shared.
                        </p>

                        {/* Options */}
                        <div className="space-y-3">
                          {/* Download Data */}
                          <button
                            onClick={handleDownloadData}
                            disabled={isLoading === 'download'}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors active:bg-white/10"
                            style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                          >
                            <Diamond size={20} style={{ color: accentColor }} />
                            <div className="text-left flex-1">
                              <p className="text-white text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                                {isLoading === 'download' ? 'Downloading...' : 'Download My Data'}
                              </p>
                              <p className="text-white/40 text-xs" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                                Export all your data as JSON
                              </p>
                            </div>
                            <ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />
                          </button>

                          {/* Clear Analysis History */}
                          <button
                            onClick={handleClearHistory}
                            disabled={isLoading === 'clearHistory'}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors active:bg-white/10"
                            style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                          >
                            <Trash2 size={20} style={{ color: '#ef4444' }} />
                            <div className="text-left flex-1">
                              <p className="text-white text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                                {isLoading === 'clearHistory' ? 'Clearing...' : 'Clear Analysis History'}
                              </p>
                              <p className="text-white/40 text-xs" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                                Delete all saved analyses
                              </p>
                            </div>
                            <ChevronRight size={18} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />
                          </button>
                        </div>

                        {/* Close Button */}
                        <button
                          onClick={() => setShowPrivacyData(false)}
                          className="w-full mt-6 py-3 rounded-xl text-white/70 font-medium"
                          style={{ background: 'rgba(255, 255, 255, 0.1)', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                        >
                          Close
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Toggle component for notifications
function NotificationToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => {
        haptics.light();
        onChange(!enabled);
      }}
      className="relative w-11 h-6 rounded-full transition-colors"
      style={{
        background: enabled ? 'rgba(185, 136, 232, 0.6)' : 'rgba(255, 255, 255, 0.15)',
      }}
    >
      <motion.div
        className="absolute top-1 w-4 h-4 rounded-full bg-white"
        animate={{ left: enabled ? '24px' : '4px' }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  );
}
