import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { getAnalysisResult } from '../services/analysisService';
import { SkeletonCardStack } from './SkeletonCard';

interface CardData {
  index: number;
  categoryTitle: string;
  categoryTagline: string;
  punchyText: string;
  image: string;
}

// New 5 cards based on neuroscience analysis
const categoryDescriptions = [
  {
    title: "Intentions",
    tagline: "What he actually wants",
    fallbackImage: '/Intentions.png'
  },
  {
    title: "Chemistry",
    tagline: "What's really between you",
    fallbackImage: '/Chemistry.png'
  },
  {
    title: "Effort",
    tagline: "Who's showing up",
    fallbackImage: '/Effort.png'
  },
  {
    title: "Red & Green Flags",
    tagline: "The signs you need to see",
    fallbackImage: '/Red & Green Flags.png'
  },
  {
    title: "Trajectory",
    tagline: "Where this is heading",
    fallbackImage: '/Communication.png'
  }
];


interface SwipeableCardDeckProps {
  analysisId?: string;
  isFirstTimeFree?: boolean;
  onPaywallOpen?: () => void;
  isLoading?: boolean;
}

export function SwipeableCardDeck({ analysisId, isFirstTimeFree = false, onPaywallOpen, isLoading: externalLoading }: SwipeableCardDeckProps) {
  const [allCards, setAllCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [stackOrder, setStackOrder] = useState<number[]>([]);

  // Deal animation: callback ref + IntersectionObserver
  // (useInView doesn't work when ref starts null during skeleton phase)
  const [deckNode, setDeckNode] = useState<HTMLDivElement | null>(null);
  const [hasDealt, setHasDealt] = useState(false);

  useEffect(() => {
    if (!deckNode || hasDealt || loading || allCards.length === 0) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setHasDealt(true), 200);
          observer.disconnect();
        }
      },
      { rootMargin: '-80px' }
    );

    observer.observe(deckNode);
    return () => observer.disconnect();
  }, [deckNode, hasDealt, loading, allCards.length]);

  // Track drag state to distinguish taps from drags
  const isDraggingRef = useRef(false);
  const dragDistanceRef = useRef(0);

  useEffect(() => {
    async function loadCards() {
      if (!analysisId) {
        setLoading(false);
        return;
      }

      // Don't fetch while Phase 2 is still loading - wait for complete data
      if (externalLoading) {
        return;
      }

      const analysisResult = await getAnalysisResult(analysisId);
      console.log('[SwipeableCardDeck] Fetched data:', {
        hasResult: !!analysisResult,
        emotionalProfilesCount: analysisResult?.emotionalProfiles?.length,
        emotionalProfiles: analysisResult?.emotionalProfiles?.map(p => ({ name: p.name, category: p.category, desc: p.description?.substring(0, 50) }))
      });
      if (!analysisResult || !analysisResult.emotionalProfiles) {
        setLoading(false);
        return;
      }

      // Create 5 cards based on the new categories, using analysis data for punchy text
      // Map category titles to the keys used in emotionalProfiles
      const categoryKeyMap: Record<string, string> = {
        "Intentions": "intentions",
        "Chemistry": "chemistry",
        "Effort": "effort",
        "Red & Green Flags": "redFlagsGreenFlags",
        "Trajectory": "trajectory"
      };

      const cards: CardData[] = categoryDescriptions.map((category, index) => {
        // Find matching profile by category name (not by index, since order may differ)
        const categoryKey = categoryKeyMap[category.title];
        const profile = analysisResult.emotionalProfiles.find(p =>
          p.name === categoryKey ||
          p.category === category.title ||
          (p.category === `Red Flags & Green Flags` && category.title === "Red & Green Flags")
        );

        // Debug: log matching result
        console.log(`[SwipeableCardDeck] Matching "${category.title}":`, {
          categoryKey,
          foundProfile: !!profile,
          profileName: profile?.name,
          profileCategory: profile?.category,
          descriptionLength: profile?.description?.length || 0,
          usingFallback: !profile?.description || profile.description.trim() === ''
        });

        // Use profile description if available and non-empty, otherwise fallback
        const punchyText = (profile?.description && profile.description.trim() !== '')
          ? profile.description
          : category.tagline;

        return {
          index,
          categoryTitle: category.title,
          categoryTagline: category.tagline,
          punchyText,
          image: category.fallbackImage,  // Always use blob images
        };
      });

      setAllCards(cards);
      setStackOrder(cards.map((_, i) => cards.length - 1 - i));
      setLoading(false);
    }

    loadCards();
  }, [analysisId, externalLoading]);

  const moveTopToBottom = () => {
    setStackOrder((prev) => {
      const newOrder = [...prev];
      const top = newOrder.pop()!;
      newOrder.unshift(top);
      return newOrder;
    });
  };


  // Show skeleton when external loading (Phase 2) or internal loading
  const showSkeleton = externalLoading || loading;

  if (showSkeleton) {
    return (
      <div className="w-full max-w-md mx-auto px-[30px] pt-24">
        <div className="text-center mb-10">
          <p className="text-white/50 uppercase mb-2" style={{ fontSize: '16px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}>
            Emotional Breakdown
          </p>
          <h2 className="text-white text-3xl" style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}>
            What's Happening<br />In The Chat
          </h2>
        </div>

        {/* Skeleton card stack */}
        <div className="relative z-10 mx-auto" style={{ width: 'calc(100% - 32px)' }}>
          <SkeletonCardStack cardCount={3} />
        </div>

        {/* Loading hint */}
        <div className="flex justify-center relative z-0" style={{ marginTop: '70px' }}>
          <motion.p
            className="text-white/50 uppercase flex items-center gap-2"
            style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span>Analyzing patterns...</span>
          </motion.p>
        </div>
      </div>
    );
  }

  if (allCards.length === 0) {
    return (
      <div className="w-full max-w-md mx-auto px-[30px] pt-24">
        <div className="text-center text-white/40 text-sm">
          Emotional profile data not available for this analysis.
        </div>
      </div>
    );
  }

  const orderedCards = stackOrder.map(index => allCards[index]);

  return (
    <div className="w-full max-w-xl mx-auto px-[16px] pt-24">
      <div className="text-center mb-10">
        <p className="text-white/50 uppercase mb-2" style={{ fontSize: '16px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}>
          Emotional Breakdown
        </p>
        <h2 className="text-white text-3xl" style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}>
          What's Happening<br />In The Chat
        </h2>
      </div>

      {/* Reduced width to contain rotated cards within screen bounds */}
      <div ref={setDeckNode} className="relative z-10 mx-auto" style={{ width: 'calc(100%)', aspectRatio: '3/4.2' }}>
          {orderedCards.map((cardItem, visualIndex) => {
            const isTop = visualIndex === orderedCards.length - 1;
            const rotation = isTop ? 0 : (visualIndex - 1) * 6;
            const translateY = visualIndex * 12;
            // Card 1 (index 0) is always free, cards 2-5 are locked for first-time free users
            const isCardLocked = isFirstTimeFree && cardItem.index > 0;

            return (
              // Outer wrapper: handles stack positioning only (no interaction)
              <motion.div
                key={cardItem.index}
                className="absolute inset-0"
                style={{
                  zIndex: visualIndex,
                }}
                initial={false}
                animate={hasDealt ? {
                  rotate: rotation,
                  y: translateY,
                  scale: isTop ? 1.02 : 1,
                  opacity: 1,
                  filter: 'blur(0px)',
                } : {
                  rotate: 0,
                  y: 0,
                  scale: 0.92,
                  opacity: 0,
                  filter: 'blur(10px)',
                }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 25,
                  delay: hasDealt && !isTop ? visualIndex * 0.08 : 0,
                }}
                layout={false}
              >
                {/* Inner div: handles drag only (separate from stack position) */}
                <motion.div
                  className={`w-full h-full ${isTop ? 'cursor-pointer' : ''}`}
                  style={{ touchAction: 'none' }}
                  drag={isTop ? true : false}
                  dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  dragElastic={0.7}
                  dragSnapToOrigin={true}
                  dragMomentum={false}
                  onDragStart={() => {
                    isDraggingRef.current = true;
                    dragDistanceRef.current = 0;
                  }}
                  onDrag={(_e, { offset }) => {
                    dragDistanceRef.current = Math.abs(offset.x) + Math.abs(offset.y);
                  }}
                  onDragEnd={(_e, { offset, velocity }) => {
                    const swipeThreshold = 80;
                    const swipeVelocityThreshold = 400;
                    const totalOffset = Math.abs(offset.x) + Math.abs(offset.y);
                    const totalVelocity = Math.abs(velocity.x) + Math.abs(velocity.y);

                    if (totalOffset > swipeThreshold || totalVelocity > swipeVelocityThreshold) {
                      moveTopToBottom();
                    }

                    setTimeout(() => {
                      isDraggingRef.current = false;
                      dragDistanceRef.current = 0;
                    }, 50);
                  }}
                  onTap={() => {
                    // No-op: paywall is triggered by tapping the pill itself
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 35,
                  }}
                >
                  {/* ===== CARD - Split Design: Top Image, Bottom Content ===== */}
                    <div
                      className="absolute inset-0 rounded-[28px] overflow-hidden flex flex-col"
                      style={{
                        boxShadow: isTop ? '0 20px 60px rgba(0,0,0,0.4)' : 'none',
                        background: '#111111',
                      }}
                    >
                      <div
                        className="w-full h-full flex flex-col"
                        style={{
                          opacity: isTop ? 1 : 0.7,
                        }}
                      >
                        {/* TOP HALF - Image */}
                        <div className="relative w-full h-1/2 overflow-hidden">
                          <img
                            src={cardItem.image}
                            alt={cardItem.categoryTitle}
                            className="absolute inset-0 w-full h-full object-cover"
                            draggable="false"
                          />
                          {/* Subtle gradient at bottom of image for blending */}
                          <div
                            className="absolute bottom-0 left-0 right-0 h-16"
                            style={{
                              background: 'linear-gradient(to bottom, transparent 0%, #111111 100%)',
                            }}
                          />
                        </div>

                        {/* BOTTOM HALF - Content */}
                        <div className="relative z-10 w-full h-1/2 flex flex-col items-center justify-start pt-6 px-6 text-center">
                          {/* Category Title */}
                          <h3
                            className="text-white"
                            style={{
                              fontSize: '24px',
                              fontFamily: 'Outfit, sans-serif',
                              fontWeight: 500,
                              letterSpacing: '1.5px',
                              marginBottom: '12px',
                            }}
                          >
                            {cardItem.categoryTitle}
                          </h3>

                          {/* Punchy Text - 2-3 lines based on chat analysis */}
                          <div className="relative max-w-[280px]">
                            <p
                              style={{
                                fontSize: '14px',
                                fontFamily: 'Plus Jakarta Sans, sans-serif',
                                fontWeight: 200,
                                lineHeight: '1.5',
                                letterSpacing: '1.5px',
                                color: 'rgba(255, 255, 255, 0.7)',
                                ...(isCardLocked ? { filter: 'blur(6px)', userSelect: 'none' as const } : {}),
                              }}
                            >
                              {cardItem.punchyText}
                            </p>
                          </div>

                          {/* Lock pill - equidistant between title and bottom edge */}
                          {isCardLocked && (
                            <div
                              className="absolute left-0 right-0 flex items-center justify-center"
                              style={{ top: '33%', bottom: 0, cursor: 'pointer' }}
                              onPointerDown={(e) => e.stopPropagation()}
                              onPointerUp={(e) => { e.stopPropagation(); onPaywallOpen?.(); }}
                            >
                              <div
                                className="flex items-center gap-2 px-4 py-3 rounded-full"
                                style={{
                                  background: '#7200B4',
                                }}
                              >
                                <Lock className="w-4 h-4 text-white" />
                                <span className="text-white font-medium uppercase whitespace-nowrap" style={{ fontSize: '13px', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1.5px' }}>
                                  See the full truth
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Dark gradient from bottom to top */}
                      <div
                        className="absolute bottom-0 left-0 right-0 rounded-b-[28px]"
                        style={{
                          height: '35%',
                          background: 'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 100%)',
                          pointerEvents: 'none',
                        }}
                      />

                      {/* Darkening overlay for non-top cards */}
                      {!isTop && (
                        <div
                          className="absolute inset-0 rounded-[28px]"
                          style={{
                            backgroundColor: 'rgba(0, 0, 0, 0.15)',
                          }}
                        />
                      )}

                    </div>
                </motion.div>
              </motion.div>
            );
          })}
      </div>

      {/* Swipe hint - positioned below the card stack */}
      <div className="flex justify-center relative z-0" style={{ marginTop: '70px' }}>
        <motion.p
          className="text-white/50 uppercase flex items-center gap-2"
          style={{ fontSize: '11px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <img src="/hand%20(2).png" alt="" className="w-5 h-5 opacity-70" />
          <span>Swipe the card</span>
        </motion.p>
      </div>
    </div>
  );
}
