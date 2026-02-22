import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Lock, MoreVertical, X, Pencil, Camera, MessageCircle, Archive, Trash2, Check } from 'lucide-react';
import { SoulTypeMedia } from './SoulTypeMedia';
import { ScoreRing, getColorAtPercentage } from './ScoreRing';
import { ToxicOrb } from './ToxicOrb';
import { MetricBar } from './MetricBar';
import { PaywallModal } from './PaywallModal';
import {
  fetchPersonProfile,
  PersonProfileData,
  getScoreColor,
  HardTruthCard,
  RelationshipStatus,
  RELATIONSHIP_STATUS_OPTIONS,
  updatePersonName,
  updatePersonAvatar,
  updateRelationshipStatus,
  archivePerson,
  deletePerson,
} from '../services/personProfileService';
import { DynamicCard } from './DynamicCard';
import { haptics } from '../utils/haptics';
import { getUserState, UserState, canPurchaseSingleUnlock } from '../services/userStateService';
import { createSubscriptionCheckout, createSingleUnlockCheckout } from '../services/stripeService';

interface PersonProfileProps {
  personId: string;
  onBack: () => void;
  onAnalyzeNew: () => void;
}

// ===== Section animation wrapper =====
function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
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

// ===== SECTION: CINEMATIC HERO =====
function HeroSection({ data }: { data: PersonProfileData }) {
  const { person, archetype } = data;

  // Compute archetype accent color (midpoint of gradient)
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) };
  };
  const from = hexToRgb(archetype.gradientFrom);
  const to = hexToRgb(archetype.gradientTo);
  const accentColor = `rgb(${Math.round((from.r + to.r) / 2)}, ${Math.round((from.g + to.g) / 2)}, ${Math.round((from.b + to.b) / 2)})`;

  const avatarUrl = person.avatar || '/67320b97b9sdfacf6001d2d3e5b.jpg';
  const archetypeImageUrl = '/image_r6qZ9PP4_1770361994322_1024.jpg';

  return (
    <div className="relative w-full overflow-hidden" style={{ minHeight: '45vh' }}>
      {/* Blurred archetype background */}
      <img
        src={archetypeImageUrl}
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
          height: '70%',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.7) 60%, #111111 100%)',
          zIndex: 2,
        }}
      />

      {/* Content */}
      <div className="relative flex flex-col items-center justify-center text-center px-8" style={{ zIndex: 3, minHeight: '45vh' }}>
        {/* Avatar with Pulsing Halo Ring */}
        <div className="relative">
          {/* Outer pulsing halo ring */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              margin: '-4px',
              border: `1.5px solid ${accentColor}`,
            }}
            animate={{
              opacity: [0.3, 0.6, 0.3],
              scale: [1, 1.05, 1],
              boxShadow: [`0 0 8px ${accentColor}30`, `0 0 15px ${accentColor}50`, `0 0 8px ${accentColor}30`],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          {/* Avatar container */}
          <div
            className="w-24 h-24 rounded-full overflow-hidden relative"
            style={{
              boxShadow: `0 0 25px ${accentColor}40`,
              border: `2px solid ${accentColor}60`,
            }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={person.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${archetype.gradientFrom}, ${archetype.gradientTo})` }}>
                <span className="text-white text-3xl font-semibold">{person.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
          </div>

          {/* Notification badge */}
          <div
            className="absolute flex items-center justify-center"
            style={{
              top: '-2px',
              right: '-2px',
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: accentColor,
              border: '2px solid black',
              zIndex: 5,
            }}
          >
            <span
              style={{
                fontSize: '10px',
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontWeight: 600,
                color: '#FFFFFF',
              }}
            >
              {person.totalAnalyses}
            </span>
          </div>
        </div>

        {/* Name */}
        <h1
          className="text-white mt-4"
          style={{ fontSize: '22px', fontWeight: 500, fontFamily: 'Plus Jakarta Sans, sans-serif' }}
        >
          {person.name}
        </h1>

        {/* Relationship Status Pill */}
        {person.relationshipStatus && (
          <div
            className="mt-2 px-3 py-1 rounded-full"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontWeight: 200,
                letterSpacing: '1.5px',
                color: 'rgba(255, 255, 255, 0.7)',
              }}
            >
              {RELATIONSHIP_STATUS_OPTIONS.find(o => o.value === person.relationshipStatus)?.emoji}{' '}
              {RELATIONSHIP_STATUS_OPTIONS.find(o => o.value === person.relationshipStatus)?.label}
            </span>
          </div>
        )}

        {/* Archetype title */}
        <p
          className="mt-1"
          style={{ fontSize: '24px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', color: '#FFFFFF' }}
        >
          {archetype.title}
        </p>

        {/* Tagline from description */}
        {archetype.description && (
          <p
            className="mt-2"
            style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255,255,255,0.5)' }}
          >
            {archetype.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ===== CountUp hook for animated numbers =====
function useCountUp(target: number, duration = 800, trigger = true): number {
  const [value, setValue] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!trigger || hasAnimated.current) return;
    hasAnimated.current = true;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutQuart
      const eased = 1 - Math.pow(1 - progress, 4);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [target, duration, trigger]);

  return value;
}

// ===== Single Vital Card with countUp =====
function VitalCard({ numericValue, suffix, label, accentColor, delay, backgroundImage, icon }: {
  numericValue: number;
  suffix: string;
  label: string;
  accentColor: string;
  delay: number;
  backgroundImage?: string;
  icon?: React.ReactNode;
}) {
  const [inView, setInView] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const animatedValue = useCountUp(numericValue, 800, inView);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="rounded-[20px] relative overflow-hidden"
      style={{
        background: '#111111',
        padding: '20px',
      }}
    >
      {backgroundImage && (
        <>
          <img
            src={backgroundImage}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 0.6 }}
          />
          {/* Gradient overlay + glassmorphism from bottom to top */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to top, rgba(0,0,0,0.70) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.05) 70%, transparent 100%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              maskImage: 'linear-gradient(to top, black 0%, black 30%, transparent 70%)',
              WebkitMaskImage: 'linear-gradient(to top, black 0%, black 30%, transparent 70%)',
            }}
          />
        </>
      )}
      {/* Icons temporarily disabled
      {icon && (
        <div className="absolute top-4 right-4 z-10 text-white/40" style={{ width: '18px', height: '18px' }}>
          {icon}
        </div>
      )}
      */}
      {/* Value */}
      <p
        className="text-white relative z-10"
        style={{
          fontSize: '20px',
          fontWeight: 700,
          fontFamily: 'Satoshi, sans-serif',
          lineHeight: '1.1',
        }}
      >
        {animatedValue}{suffix}
      </p>
      {/* Label */}
      <p
        className="text-white/70 mt-1.5 relative z-10"
        style={{ fontSize: '13px', letterSpacing: '0.02em', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
      >
        {label}
      </p>
    </motion.div>
  );
}

// ===== SECTION: ARCHETYPE CARD (Shareable Style) =====

// Mini score ring for the archetype card
function MiniScoreRing({ score, maxScore = 100 }: { score: number; maxScore?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 56;
  const radius = 22;
  const strokeWidth = 4;
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

    // Score arc
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
          className="font-bold leading-none text-white"
          style={{ fontSize: '16px', fontFamily: 'Satoshi, sans-serif' }}
        >
          {score}
        </span>
      </div>
    </div>
  );
}

function getToxicityLabel(score: number): string {
  if (score <= 30) return 'Barely a Red Flag';
  if (score <= 50) return 'Low-key Toxic';
  if (score <= 65) return 'Certified Toxic';
  if (score <= 80) return 'Dangerously Toxic';
  return 'Run.';
}

// Fallback image for development
const DEV_ARCHETYPE_IMAGE_FALLBACK = '/Adobe Express - file 1 (3).png';

// Light accent color for user's archetype card (warm coral/peach tone)
const DEV_USER_ARCHETYPE_ACCENT_LIGHT = '#fda4af'; // Light rose accent for title

function ArchetypeCardSection({ data }: { data: PersonProfileData }) {
  const { archetype, verdict } = data;
  const score = verdict.overallScore;
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <Section className="pt-20">
      <SectionHeader label="Who He Is" title="His Soul Type" />

      {/* Flippable Card Container */}
      <div
        className="relative w-full cursor-pointer"
        style={{
          perspective: '1000px',
          aspectRatio: '9/16',
        }}
        onClick={() => setIsFlipped(!isFlipped)}
      >
        <motion.div
          className="relative w-full h-full"
          style={{ transformStyle: 'preserve-3d' }}
          initial={false}
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* FRONT SIDE */}
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
              src={(archetype.imageUrl || DEV_ARCHETYPE_IMAGE_FALLBACK)}
              alt={archetype.title}
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

            {/* Content layer - ABOVE blur, not affected by it */}
            <div
              className="absolute bottom-0 left-0 right-0 px-6 pb-[40px] flex flex-col items-center text-center"
              style={{ zIndex: 10 }}
            >
              {/* Archetype Title */}
              <h3
                style={{ fontSize: '32px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px', lineHeight: '1.3', color: '#FFFFFF' }}
              >
                {archetype.title}
              </h3>

              {/* Soul Type Tagline */}
              <p
                className="mt-2 max-w-[280px]"
                style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.7)' }}
              >
                {archetype.tagline || archetype.shareableTagline || archetype.description}
              </p>

              {/* Toxicity Badge - Blob + Label */}
              <div className="flex items-center justify-center gap-3 mt-4">
                <ToxicOrb score={score} size={42} fontSizeOverride={14} />
                <div className="flex flex-col items-start">
                  <span
                    className="text-white font-bold"
                    style={{ fontSize: '18px', fontFamily: 'Satoshi, sans-serif' }}
                  >
                    {getToxicityLabel(score)}
                  </span>
                  <span
                    className="text-white/40"
                    style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                  >
                    Toxicity Score
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* BACK SIDE */}
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
              src={(archetype.imageUrl || DEV_ARCHETYPE_IMAGE_FALLBACK)}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Glassmorphism overlay - 100% */}
            <div
              className="absolute inset-0"
              style={{
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
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
              {/* Description Section */}
              <div className="px-8 flex flex-col items-center text-center">
                <h3
                  className="text-white mb-3"
                  style={{ fontSize: '18px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
                >
                  Who He Really Is
                </h3>
                <p
                  className="text-white/70"
                  style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                >
                  {archetype.description}
                </p>
              </div>

              {/* Divider */}
              <div className="mx-8 my-8">
                <div className="w-full h-px bg-white/10" />
              </div>

              {/* Traits Section */}
              <div className="px-8 flex flex-col items-center text-center">
                <h3
                  className="text-white mb-3"
                  style={{ fontSize: '18px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
                >
                  His Traits
                </h3>
                {archetype.traits.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-2 mt-2">
                    {archetype.traits.map((trait, i) => (
                      <span
                        key={i}
                        className="text-white rounded-full"
                        style={{
                          fontSize: '11px',
                          fontFamily: 'Plus Jakarta Sans, sans-serif',
                          fontWeight: 200,
                          letterSpacing: '1.5px',
                          padding: '6px 14px',
                          background: 'rgba(255, 255, 255, 0.1)',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                        }}
                      >
                        {trait}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* Tap hint */}
      <div className="flex justify-center mt-4">
        <motion.p
          className="text-white/50 uppercase flex items-center gap-2"
          style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <span>Tap to {isFlipped ? 'flip back' : 'reveal more'}</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-70"
          >
            <path d="M7 17L17 7M17 7H7M17 7V17" />
          </svg>
        </motion.p>
      </div>
    </Section>
  );
}

// ===== SECTION: VITAL SIGNS =====
function VitalSignsSection({ data }: { data: PersonProfileData }) {
  const { vitalSigns } = data;

  const cards = [
    {
      numericValue: vitalSigns.emotionalAge,
      suffix: '',
      label: 'Emotional Age',
      accentColor: vitalSigns.emotionalAge < 18 ? '#ef4444' : vitalSigns.emotionalAge < 25 ? '#facc15' : '#4ade80',
      backgroundImage: '/Screenshot 2026-02-06 194956(6).png',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0" />
        </svg>
      ),
    },
    {
      numericValue: vitalSigns.heLikesYou,
      suffix: '/10',
      label: 'He Likes You',
      accentColor: vitalSigns.heLikesYou > 6 ? '#4ade80' : vitalSigns.heLikesYou > 4 ? '#facc15' : '#ef4444',
      backgroundImage: '/Screenshot 2026-02-06 194956(5).png',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      ),
    },
    {
      numericValue: vitalSigns.justWantsSex,
      suffix: '/10',
      label: 'Just Wants Sex',
      accentColor: vitalSigns.justWantsSex > 6 ? '#ef4444' : vitalSigns.justWantsSex > 4 ? '#facc15' : '#4ade80',
      backgroundImage: '/Screenshot 2026-02-06 194956(4).png',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z" />
        </svg>
      ),
    },
    {
      numericValue: vitalSigns.ghostRisk,
      suffix: '/10',
      label: 'Ghost Risk',
      accentColor: vitalSigns.ghostRisk > 6 ? '#ef4444' : vitalSigns.ghostRisk > 4 ? '#facc15' : '#4ade80',
      backgroundImage: '/Screenshot 2026-02-06 194956(3).png',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M12 2C7.03 2 3 6.03 3 11v7c0 1.1.9 2 2 2h1c1.1 0 2-.9 2-2v-1c0-.55.45-1 1-1s1 .45 1 1v2c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-2c0-.55.45-1 1-1s1 .45 1 1v1c0 1.1.9 2 2 2h1c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9zm-3 10c-.83 0-1.5-.67-1.5-1.5S8.17 9 9 9s1.5.67 1.5 1.5S9.83 12 9 12zm6 0c-.83 0-1.5-.67-1.5-1.5S14.17 9 15 9s1.5.67 1.5 1.5S15.83 12 15 12z" />
        </svg>
      ),
    },
    {
      numericValue: vitalSigns.manipulationLevel,
      suffix: '/10',
      label: 'Manipulation',
      accentColor: vitalSigns.manipulationLevel > 6 ? '#ef4444' : vitalSigns.manipulationLevel > 4 ? '#facc15' : '#4ade80',
      backgroundImage: '/Screenshot 2026-02-06 194956(2).png',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      ),
    },
    {
      numericValue: vitalSigns.powerOverYou,
      suffix: '/10',
      label: 'Power Over You',
      accentColor: vitalSigns.powerOverYou > 6 ? '#ef4444' : vitalSigns.powerOverYou > 4 ? '#facc15' : '#4ade80',
      backgroundImage: '/Screenshot 2026-02-06 194956.png',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1v-1h14v1z" />
        </svg>
      ),
    },
  ];

  return (
    <Section className="pt-24">
      <SectionHeader label="Vital Signs" title="The Numbers Don't Lie" />
      <div className="grid grid-cols-2 gap-3">
        {cards.map((card, index) => (
          <VitalCard
            key={card.label}
            numericValue={card.numericValue}
            suffix={card.suffix}
            label={card.label}
            accentColor={card.accentColor}
            delay={index * 0.1}
            backgroundImage={card.backgroundImage}
            icon={card.icon}
          />
        ))}
      </div>
    </Section>
  );
}

// ===== SECTION: THE HARD TRUTHS — Card Fan + Scratch =====

// Scratch Canvas Component - draws on top of background with frosted effect
function ScratchCanvas({
  width,
  height,
  onReveal,
  onScratchStart,
  backgroundImage,
}: {
  width: number;
  height: number;
  onReveal: () => void;
  onScratchStart?: () => void;
  backgroundImage: string;
}) {
  const hasStartedScratching = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const hasRevealed = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset hasRevealed when component remounts
    hasRevealed.current = false;

    // Load the background image and create a darkened/frosted version
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Draw the image scaled to fill the canvas
      ctx.drawImage(img, 0, 0, width, height);

      // Apply dark overlay to make it distinct
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, width, height);

      // Add noise/grain texture for scratch effect
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        // Add grain noise
        const noise = (Math.random() - 0.5) * 20;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));

        // Random sparkle points
        if (Math.random() > 0.997) {
          data[i] = Math.min(255, data[i] + 50);
          data[i + 1] = Math.min(255, data[i + 1] + 50);
          data[i + 2] = Math.min(255, data[i + 2] + 60);
        }
      }
      ctx.putImageData(imageData, 0, 0);
    };
    img.src = backgroundImage;
  }, [width, height, backgroundImage]);

  const scratch = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = 'destination-out';

    // Draw a line from last position to current for smoother scratching
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(x, y);
    ctx.lineWidth = 50;
    ctx.lineCap = 'round';
    ctx.stroke();

    lastPos.current = { x, y };

    // Check reveal percentage (sample every 4th pixel for performance)
    if (!hasRevealed.current) {
      const imageData = ctx.getImageData(0, 0, width, height);
      let transparent = 0;
      for (let i = 3; i < imageData.data.length; i += 16) {
        if (imageData.data[i] === 0) transparent++;
      }
      const totalSampled = (width * height) / 4;
      const revealedPercent = (transparent / totalSampled) * 100;
      if (revealedPercent > 95) {
        hasRevealed.current = true;
        onReveal();
      }
    }
  };

  const getCoords = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    // Scale coordinates to canvas size
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;

    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: ((e as React.MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as React.MouseEvent).clientY - rect.top) * scaleY,
    };
  };

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    const { x, y } = getCoords(e);
    lastPos.current = { x, y };
    scratch(x, y);

    // Notify parent that scratching has started
    if (!hasStartedScratching.current && onScratchStart) {
      hasStartedScratching.current = true;
      onScratchStart();
    }
  };

  const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const { x, y } = getCoords(e);
    scratch(x, y);
  };

  const handleEnd = () => {
    isDrawing.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onMouseDown={handleStart}
      onMouseMove={handleMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      className="absolute inset-0 w-full h-full rounded-[20px] cursor-pointer touch-none"
      style={{ zIndex: 10 }}
    />
  );
}

// Background images for Hard Truth cards
const HARD_TRUTH_BACKGROUNDS = [
  '/a6feb7bac92723e3940999e610b6773a 2 (1).png',
  '/openart-5333b1f0-bb3b-492f-8e4a-f49a85bc1e52 1.png',
  '/93c320f9ed64a5802f1b027d8fe3fdcc 1.png',
  '/3274070ea55df355f08581ad2a17d525 1.png',
  '/e232995a2a04113f8d82765fa33ab601 1.png',
];

// Special background for "What's X really like?" question
const REALLY_LIKE_BACKGROUND = '/Screenshot 2026-01-25 040210.png';

// Get background image for a card (uses special bg for "really like" question)
const getCardBackground = (index: number, question?: string): string => {
  // Check if this is the "What's X really like?" question
  if (question && question.toLowerCase().includes('really like')) {
    return REALLY_LIKE_BACKGROUND;
  }
  return HARD_TRUTH_BACKGROUNDS[index % HARD_TRUTH_BACKGROUNDS.length];
};

// Extracted Card Component (full screen view)
function ExtractedTruthCard({
  card,
  index,
  totalCards,
  isScratched,
  onScratch,
  onClose,
}: {
  card: HardTruthCard;
  index: number;
  totalCards: number;
  isScratched: boolean;
  onScratch: () => void;
  onClose: () => void;
}) {
  // Same aspect ratio as carousel cards (210:280 = 3:4)
  const EXTRACTED_WIDTH = 280;
  const EXTRACTED_HEIGHT = Math.round(EXTRACTED_WIDTH * (280 / 210)); // ~373px
  const SCRATCH_HEIGHT = 130;
  const SCRATCH_WIDTH = EXTRACTED_WIDTH - 40; // 20px padding on each side

  // Track if user has started scratching (to hide "SCRATCH TO REVEAL" text)
  const [hasStartedScratching, setHasStartedScratching] = useState(false);

  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0, y: 30 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.95, opacity: 0, y: 30 }}
      transition={{ type: 'spring', damping: 28, stiffness: 250 }}
      className="relative mx-auto rounded-[24px] overflow-hidden flex flex-col"
      style={{
        width: `${EXTRACTED_WIDTH}px`,
        height: `${EXTRACTED_HEIGHT}px`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
      }}
    >
      {/* Background image */}
      <img
        src={getCardBackground(index, card.question)}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Gradient overlay + glassmorphism from bottom to top */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.30) 70%, rgba(0,0,0,0.20) 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          maskImage: 'linear-gradient(to top, black 0%, black 30%, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(to top, black 0%, black 30%, transparent 70%)',
        }}
      />

      {/* Question */}
      <div className="p-5 pb-3 flex-1 flex flex-col relative z-10">
        <motion.div
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="w-10 h-10 rounded-full flex items-center justify-center mb-3 flex-shrink-0"
          style={{
            background: 'rgba(255,255,255,0.07)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <span className="text-white/80" style={{ fontSize: '18px' }}>?</span>
        </motion.div>
        <motion.h3
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-white font-bold flex-1"
          style={{
            fontSize: '24px',
            fontFamily: 'Satoshi, sans-serif',
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }}
        >
          {card.question}
        </motion.h3>
      </div>

      {/* Answer area with scratch */}
      <div className="px-5 pb-5 relative z-10">
        <motion.div
          initial={{ opacity: 0, filter: 'blur(15px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="relative rounded-[18px] overflow-hidden"
          style={{
            height: `${SCRATCH_HEIGHT}px`,
            background: 'rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          {/* Answer (underneath scratch) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
            <p
              className="font-bold text-center"
              style={{
                fontSize: '24px',
                fontFamily: 'Satoshi, sans-serif',
                color: card.answer.verdictColor,
                textShadow: `0 0 20px ${card.answer.verdictColor}40`,
              }}
            >
              {card.answer.verdict}
            </p>
            {isScratched && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-white/60 text-center mt-2"
                style={{
                  fontSize: '12px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical' as const,
                  overflow: 'hidden',
                }}
              >
                {card.answer.proof}
              </motion.p>
            )}
          </div>

          {/* Dark overlay before scratched */}
          {!isScratched && (
            <div
              className="absolute inset-0 z-[1]"
              style={{
                background: 'rgba(0,0,0,0.4)',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Scratch overlay */}
          {!isScratched && (
            <ScratchCanvas
              width={SCRATCH_WIDTH}
              height={SCRATCH_HEIGHT}
              onReveal={onScratch}
              onScratchStart={() => setHasStartedScratching(true)}
              backgroundImage={getCardBackground(index, card.question)}
            />
          )}

          {/* SCRATCH TO REVEAL text - hidden when user starts scratching */}
          {!isScratched && !hasStartedScratching && (
            <motion.div
              initial={{ opacity: 0, filter: 'blur(8px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.4, delay: 0.55 }}
              className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none"
            >
              <span
                style={{
                  color: '#FFFFFF',
                  fontSize: '14px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontWeight: 700,
                  letterSpacing: '1px',
                  textShadow: '0 2px 10px rgba(0,0,0,0.8)',
                }}
              >
                SCRATCH TO REVEAL
              </span>
            </motion.div>
          )}
        </motion.div>

        {/* Progress indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="text-center mt-3"
        >
          <span className="text-white/40" style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            {index + 1} of {totalCards}
          </span>
        </motion.div>
      </div>

      {/* Close button - just X icon, no circle */}
      <motion.button
        initial={{ opacity: 0, filter: 'blur(5px)' }}
        animate={{ opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 0.3, delay: 0.15 }}
        onClick={onClose}
        className="absolute top-5 right-5 z-20 flex items-center justify-center active:scale-90 transition-transform"
      >
        <span className="text-white/30" style={{ fontSize: '36px', fontWeight: 200, lineHeight: 1 }}>×</span>
      </motion.button>
    </motion.div>
  );
}

function HardTruthsSection({ data, isLocked, onUnlockClick }: { data: PersonProfileData; isLocked?: boolean; onUnlockClick?: () => void }) {
  const { hardTruths } = data;
  const [activeIndex, setActiveIndex] = useState(0);
  const [extractedIndex, setExtractedIndex] = useState<number | null>(null);
  const [scratchedCards, setScratchedCards] = useState<boolean[]>(new Array(hardTruths.cards.length).fill(false));
  const [direction, setDirection] = useState(0); // -1 = prev, 1 = next
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const dragDelta = useRef(0);
  const isDraggingRef = useRef(false);

  const cards = hardTruths.cards;
  const totalCards = cards.length;

  // Card fan configuration - larger cards, no gaps between them
  const CARD_WIDTH = 210;
  const CARD_HEIGHT = 280;
  const FAN_ROTATION = 15; // degrees between cards
  const HORIZONTAL_SPREAD = 75; // reduced so cards touch/overlap

  // Get the actual card index with infinite loop wrapping
  const getWrappedIndex = useCallback((index: number): number => {
    return ((index % totalCards) + totalCards) % totalCards;
  }, [totalCards]);

  // Navigate to a specific direction
  const navigate = useCallback((dir: number) => {
    haptics.swipe();
    setDirection(dir);
    setActiveIndex(prev => getWrappedIndex(prev + dir));
  }, [getWrappedIndex]);

  // Use native event listeners with { passive: false } to truly prevent scroll
  // Also handle tap detection since preventDefault blocks click events
  const touchStartPos = useRef({ x: 0, y: 0 });
  const touchTarget = useRef<EventTarget | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || extractedIndex !== null) return;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      dragStartX.current = e.touches[0].clientX;
      dragDelta.current = 0;
      // Store start position for tap detection
      touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchTarget.current = e.target;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const currentX = e.touches[0].clientX;
      dragDelta.current = currentX - dragStartX.current;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = false;

      const deltaX = Math.abs(dragDelta.current);

      // Check if this was a tap (minimal movement)
      if (deltaX < 10) {
        // This was a tap - find which card was tapped
        const target = touchTarget.current as HTMLElement;
        if (target) {
          // Find the card element by traversing up
          const cardEl = target.closest('[data-card-index]') as HTMLElement;
          if (cardEl) {
            const cardIndex = parseInt(cardEl.dataset.cardIndex || '0', 10);
            // Calculate visual offset inline
            let offset = cardIndex - activeIndex;
            if (offset > totalCards / 2) offset -= totalCards;
            if (offset < -totalCards / 2) offset += totalCards;

            if (Math.abs(offset) <= 2) {
              if (offset === 0) {
                // Center card - check if locked first
                if (isLocked) {
                  onUnlockClick?.();
                } else {
                  setExtractedIndex(cardIndex);
                }
              } else {
                // Side card - navigate to it
                setDirection(offset);
                setActiveIndex(cardIndex);
              }
            }
          }
        }
      } else if (dragDelta.current > 40) {
        navigate(-1); // Previous
      } else if (dragDelta.current < -40) {
        navigate(1); // Next
      }

      dragDelta.current = 0;
      touchTarget.current = null;
    };

    // Add listeners with { passive: false } to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [extractedIndex, navigate, activeIndex, totalCards, isLocked, onUnlockClick]);

  const handleCardClick = (visualOffset: number, actualIndex: number) => {
    if (isDraggingRef.current && Math.abs(dragDelta.current) > 10) return;
    haptics.light();
    if (visualOffset === 0) {
      // Center card - check if locked first
      if (isLocked) {
        onUnlockClick?.();
      } else {
        setExtractedIndex(actualIndex);
      }
    } else {
      // Side card - navigate to it with direction
      setDirection(visualOffset);
      setActiveIndex(actualIndex);
    }
  };

  const handleScratch = (index: number) => {
    haptics.reveal();
    setScratchedCards(prev => {
      const newState = [...prev];
      newState[index] = true;
      return newState;
    });
  };

  const handleCloseExtracted = () => {
    setExtractedIndex(null);
  };

  const scratchedCount = scratchedCards.filter(Boolean).length;

  if (cards.length === 0) {
    return null;
  }

  // Calculate visual offset for a card index relative to active index
  // Returns value in range that maps to visible positions
  const getVisualOffset = (cardIndex: number): number => {
    let offset = cardIndex - activeIndex;
    // Handle wrapping for infinite loop effect
    if (offset > totalCards / 2) offset -= totalCards;
    if (offset < -totalCards / 2) offset += totalCards;
    return offset;
  };

  // Get position values for a given offset
  // Note: opacity is always 1 to keep cards fully opaque (not see-through)
  const getPositionValues = (offset: number) => {
    const absOffset = Math.abs(offset);
    const isVisible = absOffset <= 2;
    return {
      x: offset * HORIZONTAL_SPREAD,
      y: absOffset * 15,
      rotate: offset * FAN_ROTATION,
      scale: absOffset === 0 ? 1 : absOffset === 1 ? 0.88 : 0.78,
      opacity: isVisible ? 1 : 0,
      zIndex: 10 - absOffset,
      filter: absOffset === 0 ? 'brightness(1)' : absOffset === 1 ? 'brightness(0.75)' : 'brightness(0.5)',
      pointerEvents: isVisible ? 'auto' : 'none',
    };
  };

  return (
    <Section className="pt-24">
      <SectionHeader label="The Hard Truths" title="Questions You're Afraid to Ask" />

      {extractedIndex !== null ? (
        // Extracted card view
        <ExtractedTruthCard
          card={cards[extractedIndex]}
          index={extractedIndex}
          totalCards={totalCards}
          isScratched={scratchedCards[extractedIndex]}
          onScratch={() => handleScratch(extractedIndex)}
          onClose={handleCloseExtracted}
        />
      ) : (
        // Card Fan Carousel - 3 cards visible, infinite loop with animation
        <>
          <div
            ref={containerRef}
            className="relative mx-auto overflow-visible select-none"
            style={{
              height: '320px',
              touchAction: 'none',
              overscrollBehavior: 'none',
            }}
          >
            {/* Render ALL cards - no AnimatePresence to avoid DOM changes */}
              {cards.map((card, cardIndex) => {
                const offset = getVisualOffset(cardIndex);
                const pos = getPositionValues(offset);
                const isCenter = offset === 0;

                return (
                  <motion.div
                    key={`card-${cardIndex}`}
                    data-card-index={cardIndex}
                    style={{
                      position: 'absolute',
                      width: `${CARD_WIDTH}px`,
                      height: `${CARD_HEIGHT}px`,
                      left: '50%',
                      marginLeft: `-${CARD_WIDTH / 2}px`,
                      top: '35px',
                      transformOrigin: 'center bottom',
                      cursor: 'pointer',
                      borderRadius: '24px',
                      backgroundColor: '#0a0a0f',
                      pointerEvents: pos.pointerEvents as 'auto' | 'none',
                    }}
                    animate={{
                      x: pos.x,
                      y: pos.y,
                      rotate: pos.rotate,
                      scale: pos.scale,
                      opacity: pos.opacity,
                      zIndex: pos.zIndex,
                      filter: pos.filter,
                    }}
                    transition={{
                      type: 'spring',
                      stiffness: 300,
                      damping: 28,
                    }}
                    onClick={() => {
                      if (Math.abs(offset) <= 2) {
                        handleCardClick(offset, cardIndex);
                      }
                    }}
                  >
                    <div
                      className="w-full h-full rounded-[24px] overflow-hidden relative"
                      style={{
                        boxShadow: isCenter
                          ? '0 20px 45px rgba(0,0,0,0.5), 0 8px 20px rgba(0,0,0,0.3)'
                          : '0 10px 25px rgba(0,0,0,0.4)',
                        backfaceVisibility: 'hidden',
                      }}
                    >
                      {/* Lock overlay on each card */}
                      {isLocked && (
                        <div
                          className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[24px]"
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
                      {/* Background image */}
                      <img
                        src={getCardBackground(cardIndex, card.question)}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      {/* Gradient overlay + glassmorphism from bottom to top */}
                      <div
                        className="absolute inset-0"
                        style={{
                          background: 'linear-gradient(to top, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.30) 70%, rgba(0,0,0,0.20) 100%)',
                        }}
                      />
                      <div
                        className="absolute inset-0"
                        style={{
                          backdropFilter: 'blur(8px)',
                          WebkitBackdropFilter: 'blur(8px)',
                          maskImage: 'linear-gradient(to top, black 0%, black 30%, transparent 70%)',
                          WebkitMaskImage: 'linear-gradient(to top, black 0%, black 30%, transparent 70%)',
                        }}
                      />
                      <div className="p-5 h-full flex flex-col relative z-10">
                        {/* Question icon */}
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
                          style={{
                            background: 'rgba(255,255,255,0.07)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                          }}
                        >
                          <span className="text-white/80" style={{ fontSize: '18px' }}>?</span>
                        </div>

                        {/* Question */}
                        <h4
                          className="text-white font-bold flex-1"
                          style={{
                            fontSize: '19px',
                            fontFamily: 'Satoshi, sans-serif',
                            lineHeight: 1.35,
                            display: '-webkit-box',
                            WebkitLineClamp: 4,
                            WebkitBoxOrient: 'vertical' as const,
                            overflow: 'hidden',
                          }}
                        >
                          {card.question}
                        </h4>

                        {/* Status indicator */}
                        <div className="mt-auto flex items-center justify-between">
                          {scratchedCards[cardIndex] ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-green-500/80 flex items-center justify-center">
                                <span className="text-white text-[11px]">✓</span>
                              </div>
                              <span className="text-green-400/80" style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                                Revealed
                              </span>
                            </div>
                          ) : (
                            <span
                              className="text-white/50"
                              style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                            >
                              {isCenter ? 'Tap to reveal' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
          </div>

          {/* Navigation indicators */}
          <div className="flex flex-col items-center mt-8">
            {/* Progress dots */}
            <div className="flex items-center justify-center gap-2.5">
              {cards.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setActiveIndex(index)}
                  className="rounded-full transition-all duration-300"
                  style={{
                    width: index === activeIndex ? '24px' : '8px',
                    height: '8px',
                    background: scratchedCards[index]
                      ? '#4ade80'
                      : index === activeIndex
                        ? 'rgba(255,255,255,0.8)'
                        : 'rgba(255,255,255,0.25)',
                  }}
                />
              ))}
            </div>

            {/* Revealed counter */}
            <p className="mt-3 text-white/40" style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
              {scratchedCount}/{totalCards} revealed
            </p>
          </div>
        </>
      )}
    </Section>
  );
}

// ===== SECTION: THE VERDICT =====
function VerdictSection({ data }: { data: PersonProfileData }) {
  const { verdict } = data;

  const getScoreDescription = (score: number): string => {
    if (score <= 20) return 'Chill vibes all around.';
    if (score <= 40) return 'Mostly good energy here.';
    if (score <= 60) return 'Mixed signals detected.';
    if (score <= 80) return 'Definitely not a smooth talker.';
    return 'Get out while you can.';
  };

  return (
    <Section className="pt-24">
      <div className="flex flex-col items-center text-center">
        <SectionHeader label="Toxicity Score" title="How Toxic He Is" />

        {/* Score Ring — reusing ResultsPage component */}
        <ScoreRing score={verdict.overallScore} />

        {/* Score Label */}
        <p
          className="font-bold mt-4"
          style={{ fontSize: '22px', fontFamily: 'Satoshi, sans-serif', color: getScoreColor(verdict.overallScore) }}
        >
          {verdict.scoreLabel}
        </p>

        {/* Description */}
        <p
          className="text-white/60 mt-2"
          style={{ fontSize: '18px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          {getScoreDescription(verdict.overallScore)}
        </p>

        {/* Sub-score bars */}
        <div className="w-full mt-8">
          <MetricBar label="Warmth" value={verdict.warmthScore} color="pink" delay={200} />
          <MetricBar label="Communication" value={verdict.communicationScore} color="green" delay={400} />
          <MetricBar label="Drama" value={verdict.dramaScore} color="red" delay={600} />
          <MetricBar label="Distance" value={verdict.distanceScore} color="blue" delay={800} />
          <MetricBar label="Passion" value={verdict.passionScore} color="yellow" delay={1000} />
        </div>

        {/* Credibility + Delta */}
        <div className="mt-6 flex items-center gap-3">
          <span
            className="text-white/40 text-sm"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
          >
            Based on {verdict.totalAnalyses} {verdict.totalAnalyses === 1 ? 'conversation' : 'conversations'}
          </span>
          {verdict.scoreDelta !== 0 && (
            <span
              className={`text-sm font-semibold ${verdict.scoreDelta > 0 ? 'text-red-400' : 'text-green-400'}`}
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              {verdict.scoreDelta > 0 ? '▲' : '▼'} {verdict.scoreDelta > 0 ? '+' : ''}{verdict.scoreDelta}
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}

// ===== SECTION 2: THE RECEIPTS =====
function ReceiptsSection({ data, isLocked, onUnlockClick }: { data: PersonProfileData; isLocked?: boolean; onUnlockClick?: () => void }) {
  const { receipts } = data;
  const [activeFilter, setActiveFilter] = useState<'red' | 'green'>('red');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  const redTags = ['RED FLAG'];
  const greenTags = ['GREEN FLAG'];

  // Mock green flag messages for preview
  const mockGreenFlags = [
    { messageText: 'I just want you to know I appreciate you being honest with me', insightTitle: 'Emotional Maturity', insightTag: 'GREEN FLAG', tagColor: '#4ade80', description: 'This shows genuine appreciation for vulnerability and honesty in the relationship.', solution: '' },
    { messageText: 'Take your time, no pressure at all. I\'ll be here whenever you\'re ready', insightTitle: 'Respects Boundaries', insightTag: 'GREEN FLAG', tagColor: '#4ade80', description: 'They\'re giving you space without guilt-tripping. That\'s healthy communication.', solution: '' },
    { messageText: 'Hey I noticed you seemed off today, everything okay?', insightTitle: 'Emotionally Attentive', insightTag: 'GREEN FLAG', tagColor: '#43A047', description: 'They pay attention to your mood and check in without being asked. Major green flag.', solution: '' },
  ];

  const allMessages = activeFilter === 'red'
    ? receipts.messages.filter(msg => {
        const upper = (msg.insightTag || '').toUpperCase();
        return redTags.some(t => upper.includes(t));
      })
    : [
        ...receipts.messages.filter(msg => {
          const upper = (msg.insightTag || '').toUpperCase();
          return greenTags.some(t => upper.includes(t));
        }),
        ...mockGreenFlags,
      ];

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) {
      setScrollProgress(0);
      return;
    }
    setScrollProgress(el.scrollLeft / maxScroll);
  }, []);

  // Reset scroll position when filter changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
      setScrollProgress(0);
    }
  }, [activeFilter]);

  if (!receipts.hasData) {
    return (
      <Section className="pt-24">
        <SectionHeader label="Message Breakdown" title="" />
        <div className="rounded-[28px] p-8 text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="text-white/30 text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            No specific messages flagged yet
          </p>
        </div>
      </Section>
    );
  }

  const tagGradients: Record<string, { from: string; to: string; accent: string }> = {
    'RED FLAG': { from: '#5C1A1A', to: '#3D1212', accent: '#ff9d9d' },
    'GREEN FLAG': { from: '#1A3D2E', to: '#0D2619', accent: '#9ddf90' },
  };

  // Background images (same as MessageInsightCard)
  const RED_FLAG_BG = '/Screenshot%202026-02-01%20111831%201.png';
  const GREEN_FLAG_BG = '/Screenshot%202026-02-01%20111831%202.png';

  const getGradient = (tag: string) => {
    const upper = tag.toUpperCase();
    for (const [key, val] of Object.entries(tagGradients)) {
      if (upper.includes(key)) return val;
    }
    return { from: '#2A2A3E', to: '#1A1A2E', accent: '#3A3A5A' };
  };

  const isRedFlagTag = (tag: string) => {
    const upper = tag.toUpperCase();
    return redTags.some(t => upper.includes(t));
  };

  // Ensure accent color is dark enough for white text
  const ensureDarkEnough = (hexColor: string): string => {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (luminance > 0.45) {
      const darkenFactor = 0.45 / luminance;
      const toHex = (n: number) => Math.round(n * darkenFactor).toString(16).padStart(2, '0');
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    return hexColor;
  };

  // Lighten a color for better visibility on dark backgrounds
  const lightenColor = (hexColor: string, factor: number = 1.5): string => {
    const hex = hexColor.replace('#', '');
    const r = Math.min(255, Math.round(parseInt(hex.substring(0, 2), 16) * factor));
    const g = Math.min(255, Math.round(parseInt(hex.substring(2, 4), 16) * factor));
    const b = Math.min(255, Math.round(parseInt(hex.substring(4, 6), 16) * factor));
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  return (
    <Section className="pt-24">
      <p
        className="text-white/50 uppercase tracking-widest mb-2"
        style={{ letterSpacing: '0.15em', fontSize: '16px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
      >
        Message Breakdown
      </p>

      {/* Toggle title - outside blur */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => { haptics.light(); setActiveFilter('red'); }}
          className="transition-colors"
          style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            letterSpacing: '1.5px',
            fontSize: '28px',
            fontWeight: 700,
            whiteSpace: 'nowrap' as const,
            color: activeFilter === 'red' ? '#ffffff' : 'rgba(255,255,255,0.3)',
          }}
        >
          Red Flags
        </button>
        <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '28px', fontWeight: 200 }}>|</span>
        <button
          onClick={() => { haptics.light(); setActiveFilter('green'); }}
          className="transition-colors"
          style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            letterSpacing: '1.5px',
            fontSize: '28px',
            fontWeight: 700,
            whiteSpace: 'nowrap' as const,
            color: activeFilter === 'green' ? '#ffffff' : 'rgba(255,255,255,0.3)',
          }}
        >
          Green Flags
        </button>
      </div>

      {allMessages.length === 0 ? (
        <div className="rounded-[28px] p-8 text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="text-white/30 text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            No {activeFilter === 'red' ? 'red flags' : 'green flags'} found
          </p>
        </div>
      ) : (
        <>
          <div className="-mx-8">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex gap-4 overflow-x-auto snap-x snap-mandatory px-8 pb-4 hide-scrollbar"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
            >
              {allMessages.map((msg, index) => {
                const gradient = getGradient(msg.insightTag);
                const accentColor = ensureDarkEnough(gradient.accent);
                // Dynamic line clamp based on title length
                const titleIsLong = (msg.insightTitle || '').length > 18;
                const descriptionLineClamp = titleIsLong ? 3 : 4;
                // All cards use background images now
                const backgroundImage = isRedFlagTag(msg.insightTag) ? RED_FLAG_BG : GREEN_FLAG_BG;
                // Lighter tag color for cards with background image
                const tagColor = lightenColor(gradient.accent, 2.5);

                return (
                  <motion.div
                    key={`${activeFilter}-${index}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: index * 0.06 }}
                    className="rounded-[28px] snap-center flex-shrink-0 flex relative overflow-hidden"
                    style={{
                      background: '#1a1a1a',
                      width: '85%',
                      minWidth: '85%',
                      height: '200px',
                    }}
                  >
                    {/* Lock overlay on each card */}
                    {isLocked && (
                      <div
                        className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[28px]"
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
                    {/* Background image */}
                    <img
                      src={backgroundImage}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    {/* Dark overlay for text readability */}
                    <div className="absolute inset-0 bg-black/25" />
                    {/* Gradient overlay at the bottom */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '70%',
                        background: 'linear-gradient(to top, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.4) 40%, transparent 100%)',
                        pointerEvents: 'none',
                      }}
                    />
                    {/* Left side - Message bubble */}
                    <div className="w-1/2 h-full flex items-center justify-center p-4 relative z-10">
                      <div
                        className="px-3.5 py-2.5 rounded-[16px] w-full max-w-[130px]"
                        style={{
                          transform: 'rotate(-6deg)',
                          backgroundColor: 'rgba(0, 0, 0, 0.18)',
                          color: '#ffffff',
                        }}
                      >
                        <p style={{
                          fontSize: '12px',
                          lineHeight: '1.35',
                          fontWeight: 400,
                          fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                          display: '-webkit-box',
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: 'vertical' as const,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          "{msg.messageText}"
                        </p>
                      </div>
                    </div>

                    {/* Right side - Info */}
                    <div className="w-1/2 h-full flex flex-col justify-center px-4 py-3 relative z-10">
                      {/* Tag */}
                      <div
                        className="inline-flex items-center gap-1.5 mb-2 self-start"
                        style={{ color: tagColor }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
                          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                        </svg>
                        <span style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                          {msg.insightTag}
                        </span>
                      </div>

                      {/* Title */}
                      {msg.insightTitle && (
                        <h3
                          className="text-white mb-2"
                          style={{
                            fontSize: '17px',
                            fontWeight: 700,
                            lineHeight: '1.2',
                            fontFamily: 'Satoshi, sans-serif',
                          }}
                        >
                          {msg.insightTitle}
                        </h3>
                      )}

                      {/* Description */}
                      {msg.description && (
                        <p style={{
                          fontSize: '13px',
                          lineHeight: '1.35',
                          fontWeight: 400,
                          fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                          color: 'rgba(255, 255, 255, 0.6)',
                          display: '-webkit-box',
                          WebkitLineClamp: descriptionLineClamp,
                          WebkitBoxOrient: 'vertical' as const,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {msg.description}
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
          {/* Progress bar */}
          {allMessages.length > 1 && (
            <div className="mt-4 mx-auto" style={{ width: '40%' }}>
              <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div
                  className="h-full rounded-full transition-all duration-150 ease-out"
                  style={{
                    width: `${Math.max(20, scrollProgress * 100)}%`,
                    background: 'rgba(255,255,255,0.5)',
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ===== SECTION 3: THE PATTERN =====
function PatternSection({ data }: { data: PersonProfileData }) {
  const { pattern } = data;

  if (pattern.behaviors.length === 0) {
    return (
      <Section className="pt-24">
        <SectionHeader label="Emotional Breakdown" title="The Pattern" />
        <div className="rounded-[28px] p-8 text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="text-white/30 text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            Analyze more conversations to see patterns
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section className="pt-24">
      <SectionHeader label="Emotional Breakdown" title="The Pattern" />
      <div className="flex flex-wrap gap-3">
        {pattern.behaviors.map((behavior, index) => {
          const color = getScoreColor(behavior.severityAvg);
          return (
            <motion.div
              key={behavior.categoryName}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.06 }}
              className="rounded-full px-4 py-2.5"
              style={{
                background: `${color}20`,
                border: `1px solid ${color}40`,
              }}
            >
              <p className="text-white" style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                {behavior.archetypeName}
              </p>
              <p className="text-white/50" style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                {behavior.frequency} of {behavior.totalAnalyses}
              </p>
            </motion.div>
          );
        })}
      </div>
      {!pattern.hasEnoughData && (
        <p className="text-white/40 text-sm mt-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
          Analyze more to confirm patterns
        </p>
      )}
    </Section>
  );
}

// ===== SECTION 4: THE ARCHETYPE =====
function ArchetypeSection({ data }: { data: PersonProfileData }) {
  const { archetype } = data;

  return (
    <Section className="pt-24">
      <SectionHeader label="The Reveal" title="His Archetype" />

      {/* Archetype card — DynamicCard style */}
      <div
        className="rounded-[28px] overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${archetype.gradientFrom}, ${archetype.gradientTo})`,
        }}
      >
        {/* Header */}
        <div className="pt-8 pb-4 px-6">
          <h3
            className="text-white font-bold"
            style={{ fontSize: '22px', fontFamily: 'Satoshi, sans-serif' }}
          >
            {archetype.title}
          </h3>
          {archetype.description && (
            <p
              className="text-white/70 mt-1"
              style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              {archetype.description}
            </p>
          )}
        </div>

        {/* Archetype Image — centered, 130px, 9/16 aspect */}
        {archetype.imageUrl && (
          <div className="flex justify-center px-6 py-4">
            <SoulTypeMedia
              src={archetype.imageUrl}
              alt={archetype.title}
              className="rounded-2xl object-cover"
              style={{
                width: '130px',
                aspectRatio: '9/16',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
            />
          </div>
        )}

        {/* Traits as pills */}
        {archetype.traits.length > 0 && (
          <div className="flex flex-wrap gap-2 px-6 pb-4">
            {archetype.traits.slice(0, 5).map((trait, i) => (
              <span
                key={i}
                className="text-white rounded-full"
                style={{
                  fontSize: '9px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                  padding: '4px 10px',
                  background: `${archetype.gradientFrom}CC`,
                }}
              >
                {trait}
              </span>
            ))}
          </div>
        )}

        {/* Consistency */}
        <div className="px-6 pb-6">
          <p className="text-white/40" style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            This archetype in {archetype.consistency.matchCount} of {archetype.consistency.totalCount} conversations
          </p>
        </div>
      </div>

      {/* Evolution */}
      {archetype.evolution && archetype.evolution.length > 1 && (
        <p className="text-white/40 italic mt-4" style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
          Evolution: {[...new Set(archetype.evolution)].join(' → ')}
        </p>
      )}
    </Section>
  );
}

// ===== SECTION 5: YOUR ARCHETYPE + REALITY CHECK =====
function MirrorSection({ data, isLocked, onUnlockClick }: { data: PersonProfileData; isLocked?: boolean; onUnlockClick?: () => void }) {
  const { mirror } = data;

  if (!mirror.hasEnoughData) {
    return (
      <Section className="pt-24">
        <SectionHeader label="The Dynamic" title="Your Souls Together" />
        <div className="rounded-[28px] p-8 text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="text-white/30 text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            Analyze more for deeper insights
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section className="pt-24">
      <SectionHeader label="The Dynamic" title="Your Souls Together" />

      <DynamicCard
        dynamicName={mirror.dynamicName}
        subtitle={mirror.dynamicSubtitle}
        whyThisHappens={mirror.whyThisHappens}
        patternBreak={mirror.patternBreak}
        powerBalance={mirror.powerBalance}
        gradientStart={mirror.dynamicGradientFrom}
        gradientEnd={mirror.dynamicGradientTo}
        personName={mirror.personName}
        personArchetype={{
          name: mirror.personArchetypeTitle,
          title: mirror.personArchetypeTitle,
          imageUrl: mirror.personArchetypeImage,
          sideProfileImageUrl: mirror.personArchetypeSideImage,
        }}
        userArchetype={{
          name: mirror.userArchetypeTitle,
          title: mirror.userArchetypeTitle,
          imageUrl: mirror.userArchetypeImage,
          sideProfileImageUrl: mirror.userArchetypeSideImage,
        }}
        isFirstTimeFree={isLocked}
        onPaywallOpen={onUnlockClick}
      />

      {/* Share Your Dynamic Button */}
      <motion.div
        className="mt-6"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.3 }}
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
    </Section>
  );
}

// ===== SECTION 6: THE TRAJECTORY =====
function TrajectorySection({ data }: { data: PersonProfileData }) {
  const { trajectory } = data;

  if (trajectory.points.length === 0) return null;

  const patternColors: Record<string, string> = {
    'Escalating': '#ef4444',
    'Stable': '#facc15',
    'De-escalating': '#4ade80',
  };

  return (
    <Section className="pt-24">
      <SectionHeader label="Trend" title="The Trajectory" />

      <div
        className="rounded-[28px] p-8"
        style={{ background: 'rgba(255,255,255,0.05)' }}
      >
        {/* Colored dots */}
        <div className="flex items-center justify-center gap-2.5 mb-5 flex-wrap">
          {trajectory.points.map((point, i) => {
            const color = getScoreColor(point.score);
            return (
              <motion.div
                key={i}
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.08 }}
                className="w-3 h-3 rounded-full"
                style={{
                  background: color,
                  boxShadow: `0 0 8px ${color}40`,
                }}
              />
            );
          })}
        </div>

        {/* Pattern label + percentage */}
        {trajectory.hasEnoughData ? (
          <div className="text-center">
            <span
              className="font-bold"
              style={{
                fontSize: '18px',
                color: patternColors[trajectory.patternLabel],
                fontFamily: 'Satoshi, sans-serif',
              }}
            >
              {trajectory.patternLabel} {trajectory.patternLabel === 'Escalating' ? '▲' : trajectory.patternLabel === 'De-escalating' ? '▼' : '─'}
            </span>
            {trajectory.percentChange !== 0 && (
              <span className="text-white/50 ml-2" style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                {trajectory.percentChange > 0 ? '+' : ''}{trajectory.percentChange}% over time
              </span>
            )}
          </div>
        ) : (
          <p className="text-white/40 text-sm text-center" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            Analyze again to track changes
          </p>
        )}
      </div>
    </Section>
  );
}

// ===== SECTION 7: THE POWER MOVE =====
function PowerMoveSection({ data, onAnalyzeNew }: { data: PersonProfileData; onAnalyzeNew: () => void }) {
  const { powerMove } = data;

  return (
    <Section className="pt-24 pb-24">
      <SectionHeader label="Your Move" title="Break The Pattern" />

      {powerMove.hasData ? (
        <div className="space-y-4 mb-8">
          {/* Pattern Break */}
          {powerMove.patternBreak && (
            <div
              className="rounded-[28px] p-6"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <p
                className="text-white/40 uppercase tracking-widest mb-3"
                style={{ fontSize: '12px', letterSpacing: '0.15em', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                Pattern Break
              </p>
              <p className="text-white/80" style={{ fontSize: '15px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: '1.5' }}>
                {powerMove.patternBreak}
              </p>
            </div>
          )}

          {/* Script */}
          {powerMove.solutions.length > 0 && (
            <div
              className="rounded-[28px] p-6"
              style={{ background: 'rgba(255,255,255,0.05)' }}
            >
              <p
                className="text-white/40 uppercase tracking-widest mb-3"
                style={{ fontSize: '12px', letterSpacing: '0.15em', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                The Script
              </p>
              <p className="text-white/70 italic" style={{ fontSize: '15px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', lineHeight: '1.5' }}>
                "{powerMove.solutions[0]}"
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-[28px] p-8 text-center mb-8" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="text-white/30 text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            Analyze more for personalized advice
          </p>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => { haptics.medium(); onAnalyzeNew(); }}
        className="w-full text-white rounded-full font-bold active:scale-95 transition-transform"
        style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
          fontSize: '16px',
          padding: '16px 24px',
          background: 'linear-gradient(to right, #7c3aed, #06b6d4)',
        }}
      >
        Analyze New Conversation
      </button>
    </Section>
  );
}


// ===== SETTINGS BOTTOM SHEET =====
interface PersonSettingsBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  person: { id: string; name: string; avatar: string | null; relationshipStatus: RelationshipStatus };
  onPersonUpdated: () => void;
  onPersonDeleted: () => void;
  onPersonArchived: () => void;
}

function PersonSettingsBottomSheet({
  isOpen, onClose, person, onPersonUpdated, onPersonDeleted, onPersonArchived
}: PersonSettingsBottomSheetProps) {
  const [view, setView] = useState<'menu' | 'rename' | 'relationship' | 'confirm-archive' | 'confirm-delete'>('menu');
  const [editName, setEditName] = useState(person.name);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset view when opening
  useEffect(() => {
    if (isOpen) {
      setView('menu');
      setEditName(person.name);
    }
  }, [isOpen, person.name]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const handleRename = async () => {
    if (!editName.trim() || editName.trim() === person.name) { setView('menu'); return; }
    setIsSaving(true);
    const success = await updatePersonName(person.id, editName.trim());
    setIsSaving(false);
    if (success) {
      haptics.success();
      onPersonUpdated();
      onClose();
    }
  };

  const handleRelationshipSelect = async (status: RelationshipStatus) => {
    setIsSaving(true);
    const success = await updateRelationshipStatus(person.id, status);
    setIsSaving(false);
    if (success) {
      haptics.success();
      onPersonUpdated();
      onClose();
    }
  };

  const handleArchive = async () => {
    setIsSaving(true);
    const success = await archivePerson(person.id);
    setIsSaving(false);
    if (success) {
      haptics.medium();
      onPersonArchived();
    }
  };

  const handleDelete = async () => {
    setIsSaving(true);
    haptics.heavy();
    const success = await deletePerson(person.id);
    setIsSaving(false);
    if (success) {
      onPersonDeleted();
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setIsSaving(true);
      const success = await updatePersonAvatar(person.id, dataUrl);
      setIsSaving(false);
      if (success) {
        haptics.success();
        onPersonUpdated();
        onClose();
      }
    };
    reader.readAsDataURL(file);
  };

  const menuItemStyle = {
    fontSize: '15px',
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    fontWeight: 200 as const,
    letterSpacing: '1.5px',
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

          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > window.innerHeight * 0.4 || info.velocity.y > 1200) {
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
            {/* Black overlay */}
            <div className="absolute inset-0 rounded-t-[28px]" style={{ background: 'rgba(0, 0, 0, 0.4)', pointerEvents: 'none' }} />

            {/* Handle bar */}
            <div className="relative flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing" style={{ zIndex: 1 }}>
              <div className="w-12 h-1.5 rounded-full" style={{ background: 'rgba(255, 255, 255, 0.3)' }} />
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
            <div className="relative overflow-y-auto" style={{ maxHeight: 'calc(85vh - 60px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 24px) + 80px)', zIndex: 1 }}>

              {/* ===== MENU VIEW ===== */}
              {view === 'menu' && (
                <div className="pb-6">
                  {/* Person header */}
                  <div className="flex flex-col items-center pt-2 pb-4">
                    <div className="w-14 h-14 rounded-full overflow-hidden mb-2">
                      <img src={person.avatar || '/67320b97b9sdfacf6001d2d3e5b.jpg'} alt={person.name} className="w-full h-full object-cover" />
                    </div>
                    <h3 className="text-white" style={{ fontSize: '16px', fontFamily: 'Satoshi, sans-serif', fontWeight: 600 }}>
                      {person.name}
                    </h3>
                  </div>

                  <div className="h-px mx-4" style={{ background: 'rgba(255, 255, 255, 0.05)' }} />

                  {/* Rename */}
                  <button onClick={() => { haptics.light(); setView('rename'); }} className="w-full flex items-center gap-3 py-3.5 px-5 active:bg-white/5 transition-colors">
                    <Pencil size={20} style={{ color: 'rgba(255, 255, 255, 0.5)' }} />
                    <span style={{ ...menuItemStyle, color: 'rgba(255, 255, 255, 0.9)' }}>Rename</span>
                  </button>

                  {/* Change Photo */}
                  <button onClick={() => { haptics.light(); fileInputRef.current?.click(); }} className="w-full flex items-center gap-3 py-3.5 px-5 active:bg-white/5 transition-colors">
                    <Camera size={20} style={{ color: 'rgba(255, 255, 255, 0.5)' }} />
                    <span style={{ ...menuItemStyle, color: 'rgba(255, 255, 255, 0.9)' }}>Change Photo</span>
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />

                  {/* Relationship Status */}
                  <button onClick={() => { haptics.light(); setView('relationship'); }} className="w-full flex items-center justify-between py-3.5 px-5 active:bg-white/5 transition-colors">
                    <div className="flex items-center gap-3">
                      <MessageCircle size={20} style={{ color: 'rgba(255, 255, 255, 0.5)' }} />
                      <span style={{ ...menuItemStyle, color: 'rgba(255, 255, 255, 0.9)' }}>Relationship Status</span>
                    </div>
                    {person.relationshipStatus && (
                      <span style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, color: 'rgba(255, 255, 255, 0.4)' }}>
                        {RELATIONSHIP_STATUS_OPTIONS.find(o => o.value === person.relationshipStatus)?.label}
                      </span>
                    )}
                  </button>

                  {/* Divider */}
                  <div className="h-px mx-4 my-2" style={{ background: 'rgba(255, 255, 255, 0.05)' }} />

                  {/* Archive */}
                  <button onClick={() => { haptics.light(); setView('confirm-archive'); }} className="w-full flex items-center gap-3 py-3.5 px-5 active:bg-white/5 transition-colors">
                    <Archive size={20} style={{ color: 'rgba(255, 255, 255, 0.5)' }} />
                    <span style={{ ...menuItemStyle, color: 'rgba(255, 255, 255, 0.9)' }}>Archive</span>
                  </button>

                  {/* Delete */}
                  <button onClick={() => { haptics.light(); setView('confirm-delete'); }} className="w-full flex items-center gap-3 py-3.5 px-5 active:bg-white/5 transition-colors">
                    <Trash2 size={20} style={{ color: '#ef4444' }} />
                    <span style={{ ...menuItemStyle, color: '#ef4444' }}>Delete</span>
                  </button>
                </div>
              )}

              {/* ===== RENAME VIEW ===== */}
              {view === 'rename' && (
                <div className="px-5 pb-6 pt-2">
                  <h3 className="text-white text-lg mb-4" style={{ fontFamily: 'Satoshi, sans-serif', fontWeight: 600 }}>Rename</h3>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-white/20"
                    style={{ fontSize: '16px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
                    placeholder="Enter name..."
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => setView('menu')}
                      className="flex-1 py-3 rounded-full text-white/60"
                      style={{ background: 'rgba(255,255,255,0.05)', ...menuItemStyle }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRename}
                      disabled={isSaving || !editName.trim()}
                      className="flex-1 py-3 rounded-full text-white"
                      style={{ background: 'linear-gradient(to right, #7c3aed, #06b6d4)', ...menuItemStyle, fontWeight: 400, opacity: isSaving || !editName.trim() ? 0.5 : 1 }}
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {/* ===== RELATIONSHIP STATUS VIEW ===== */}
              {view === 'relationship' && (
                <div className="px-5 pb-6 pt-2">
                  <h3 className="text-white text-lg mb-4" style={{ fontFamily: 'Satoshi, sans-serif', fontWeight: 600 }}>Relationship Status</h3>
                  <div className="flex flex-col gap-1">
                    {RELATIONSHIP_STATUS_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        onClick={() => handleRelationshipSelect(option.value)}
                        disabled={isSaving}
                        className="w-full flex items-center justify-between py-3.5 px-4 rounded-xl active:bg-white/5 transition-colors"
                        style={{
                          background: person.relationshipStatus === option.value ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                        }}
                      >
                        <span style={{ ...menuItemStyle, color: 'rgba(255, 255, 255, 0.9)' }}>
                          {option.emoji} {option.label}
                        </span>
                        {person.relationshipStatus === option.value && (
                          <Check size={18} style={{ color: '#7c3aed' }} />
                        )}
                      </button>
                    ))}
                    {/* Clear option */}
                    {person.relationshipStatus && (
                      <button
                        onClick={() => handleRelationshipSelect(null)}
                        disabled={isSaving}
                        className="w-full py-3.5 px-4 rounded-xl text-center mt-2"
                        style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', color: 'rgba(255, 255, 255, 0.4)' }}
                      >
                        Clear status
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ===== CONFIRM ARCHIVE VIEW ===== */}
              {view === 'confirm-archive' && (
                <div className="px-5 pb-6 pt-2 text-center">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255, 255, 255, 0.05)' }}>
                    <Archive size={24} style={{ color: 'rgba(255, 255, 255, 0.5)' }} />
                  </div>
                  <h3 className="text-white text-lg mb-2" style={{ fontFamily: 'Satoshi, sans-serif', fontWeight: 600 }}>Archive {person.name}?</h3>
                  <p style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '0.5px', color: 'rgba(255, 255, 255, 0.5)', lineHeight: '1.5' }}>
                    {person.name} will be hidden from your connections. You can unarchive later.
                  </p>
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => setView('menu')}
                      className="flex-1 py-3 rounded-full text-white/60"
                      style={{ background: 'rgba(255,255,255,0.05)', ...menuItemStyle }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleArchive}
                      disabled={isSaving}
                      className="flex-1 py-3 rounded-full text-white"
                      style={{ background: 'rgba(255, 255, 255, 0.1)', ...menuItemStyle, fontWeight: 400, opacity: isSaving ? 0.5 : 1 }}
                    >
                      {isSaving ? 'Archiving...' : 'Archive'}
                    </button>
                  </div>
                </div>
              )}

              {/* ===== CONFIRM DELETE VIEW ===== */}
              {view === 'confirm-delete' && (
                <div className="px-5 pb-6 pt-2 text-center">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
                    <Trash2 size={24} style={{ color: '#ef4444' }} />
                  </div>
                  <h3 className="text-white text-lg mb-2" style={{ fontFamily: 'Satoshi, sans-serif', fontWeight: 600 }}>Delete {person.name}?</h3>
                  <p style={{ fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '0.5px', color: 'rgba(255, 255, 255, 0.5)', lineHeight: '1.5' }}>
                    This will permanently delete all analysis data for {person.name}. This action cannot be undone.
                  </p>
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => setView('menu')}
                      className="flex-1 py-3 rounded-full text-white/60"
                      style={{ background: 'rgba(255,255,255,0.05)', ...menuItemStyle }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={isSaving}
                      className="flex-1 py-3 rounded-full text-white"
                      style={{ background: '#ef4444', ...menuItemStyle, fontWeight: 400, opacity: isSaving ? 0.5 : 1 }}
                    >
                      {isSaving ? 'Deleting...' : 'Delete Forever'}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ===== MAIN COMPONENT =====
export function PersonProfile({ personId, onBack, onAnalyzeNew }: PersonProfileProps) {
  const [data, setData] = useState<PersonProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [userState, setUserState] = useState<UserState | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [paywallState, setPaywallState] = useState({
    canUseSingleUnlock: true,
    singleUnlocksRemaining: 2,
    isFirstAnalysis: false
  });

  // Determine if premium content should be locked
  // TEMPORARILY UNLOCKED - set to false to unlock all sections
  const isLocked = false;

  useEffect(() => {
    loadProfile();
    loadUserState();
  }, [personId]);

  async function loadProfile() {
    setLoading(true);
    const result = await fetchPersonProfile(personId);
    setData(result);
    setLoading(false);
  }

  async function reloadProfile() {
    const result = await fetchPersonProfile(personId);
    setData(result);
  }

  function handlePersonDeleted() {
    setShowSettings(false);
    onBack();
  }

  function handlePersonArchived() {
    setShowSettings(false);
    onBack();
  }

  async function loadUserState() {
    try {
      const state = await getUserState();
      setUserState(state);
      setPaywallState({
        canUseSingleUnlock: canPurchaseSingleUnlock(state),
        singleUnlocksRemaining: 2 - state.singleUnlocksThisMonth,
        isFirstAnalysis: !state.firstAnalysisCompleted
      });
    } catch (error) {
      console.error('Error loading user state:', error);
    }
  }

  function handleUnlockClick() {
    setShowPaywall(true);
  }

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
    const { url, error } = await createSingleUnlockCheckout(personId);

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
      <div className="min-h-screen bg-black">
        <button
          onClick={onBack}
          className="absolute top-4 left-4 z-50 text-white/60 hover:text-white transition-colors p-2"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex flex-col items-center justify-center px-8" style={{ minHeight: '70vh' }}>
          <div className="w-20 h-20 rounded-full bg-white/[0.04] animate-pulse" />
          <div className="h-5 w-28 rounded bg-white/[0.04] animate-pulse mt-4" />
          <div className="h-4 w-36 rounded bg-white/[0.03] animate-pulse mt-2" />
        </div>
      </div>
    );
  }

  // Error state
  if (!data) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-8">
        <p className="text-white/40 text-center mb-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
          No analysis data found
        </p>
        <button
          onClick={onBack}
          className="text-white/60 hover:text-white transition-colors text-sm"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black overflow-x-hidden">
      {/* Navigation buttons — floating over hero, same row */}
      <div className="absolute top-4 left-4 right-4 z-50 flex items-center justify-between pointer-events-none">
        <button
          onClick={onBack}
          className="text-white/60 hover:text-white transition-colors p-2 pointer-events-auto"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={() => { haptics.light(); setShowSettings(true); }}
          className="text-white/60 hover:text-white transition-colors p-2 pointer-events-auto"
        >
          <MoreVertical size={20} />
        </button>
      </div>

      {/* SECTION 1: Cinematic Hero (full-width) */}
      <HeroSection data={data} />

      {/* Content wrapper — full width black, overlaps hero to hide any edge */}
      <div className="w-full relative bg-black" style={{ marginTop: '-40px', zIndex: 10 }}>
      <div className="w-full max-w-md mx-auto px-8 pb-8">
        {/* SECTION: Archetype Card */}
        <ArchetypeCardSection data={data} />

        {/* CALL HIM OUT Button */}
        <motion.div
          className="mt-6"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
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
              CALL HIM OUT
            </span>
          </button>
        </motion.div>

        {/* SECTION 2: Vital Signs */}
        <VitalSignsSection data={data} />

        {/* SECTION 3: The Hard Truths - PREMIUM */}
        <HardTruthsSection data={data} isLocked={isLocked} onUnlockClick={handleUnlockClick} />

        {/* Remaining sections - PREMIUM */}
        <ReceiptsSection data={data} isLocked={isLocked} onUnlockClick={handleUnlockClick} />
        <MirrorSection data={data} isLocked={isLocked} onUnlockClick={handleUnlockClick} />
      </div>
      </div>

      <PaywallModal
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={handleSubscribe}
        onSingleUnlock={handleSingleUnlock}
        canUseSingleUnlock={paywallState.canUseSingleUnlock}
        singleUnlocksRemaining={paywallState.singleUnlocksRemaining}
        isFirstAnalysis={paywallState.isFirstAnalysis}
      />

      {/* Settings Bottom Sheet */}
      <PersonSettingsBottomSheet
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        person={data.person}
        onPersonUpdated={reloadProfile}
        onPersonDeleted={handlePersonDeleted}
        onPersonArchived={handlePersonArchived}
      />
    </div>
  );
}
