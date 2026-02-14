import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
            What The F
            <span style={{ filter: 'blur(2px)' }}>u</span>
            <span style={{ filter: 'blur(3.5px)' }}>c</span>
            <span style={{ filter: 'blur(6px)' }}>k</span>
            {' '}Is Happening<br />In The Chat
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
    <div className="w-full max-w-md mx-auto px-[30px] pt-24">
      <div className="text-center mb-10">
        <p className="text-white/50 uppercase mb-2" style={{ fontSize: '16px', letterSpacing: '1.5px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}>
          Emotional Breakdown
        </p>
        <h2 className="text-white text-3xl" style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}>
          What The F
          <span style={{ filter: 'blur(2px)' }}>u</span>
          <span style={{ filter: 'blur(3.5px)' }}>c</span>
          <span style={{ filter: 'blur(6px)' }}>k</span>
          {' '}Is Happening<br />In The Chat
        </h2>
      </div>

      {/* Reduced width to contain rotated cards within screen bounds */}
      <div ref={setDeckNode} className="relative z-10 mx-auto" style={{ width: 'calc(100% - 32px)', aspectRatio: '3/4' }}>
        <AnimatePresence initial={false}>
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
                  perspective: "1000px",
                }}
                initial={false}
                animate={hasDealt ? {
                  rotate: rotation,
                  y: translateY,
                  scale: isTop ? 1.02 : 1,
                  opacity: 1,
                } : {
                  rotate: 0,
                  y: 0,
                  scale: 0.92,
                  opacity: 0,
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
                  drag={isTop}
                  dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  dragElastic={0.9}
                  dragSnapToOrigin={true}
                  onDragStart={() => {
                    isDraggingRef.current = true;
                    dragDistanceRef.current = 0;
                  }}
                  onDrag={(e, { offset }) => {
                    dragDistanceRef.current = Math.sqrt(offset.x ** 2 + offset.y ** 2);
                  }}
                  onDragEnd={(e, { offset, velocity }) => {
                    const swipeThreshold = 80;
                    const swipeVelocityThreshold = 400;
                    const totalOffset = Math.sqrt(offset.x ** 2 + offset.y ** 2);
                    const totalVelocity = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);

                    if (totalOffset > swipeThreshold || totalVelocity > swipeVelocityThreshold) {
                      // If first-time free, open paywall instead of allowing swipe
                      // Short delay to let snap-back animation start
                      if (isFirstTimeFree) {
                        setTimeout(() => {
                          onPaywallOpen?.();
                        }, 150);
                      } else {
                        moveTopToBottom();
                      }
                    }

                    // Reset drag state after a short delay to allow tap check
                    setTimeout(() => {
                      isDraggingRef.current = false;
                      dragDistanceRef.current = 0;
                    }, 50);
                  }}
                  onTap={() => {
                    // Only handle tap if we weren't dragging (drag distance < 10px)
                    if (isDraggingRef.current && dragDistanceRef.current > 10) {
                      return;
                    }

                    if (isTop && isCardLocked) {
                      // Open paywall for locked cards
                      onPaywallOpen?.();
                    }
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 30,
                  }}
                >
                  {/* ===== CARD - Split Design: Top Image, Bottom Content ===== */}
                    <div
                      className="absolute inset-0 rounded-[28px] overflow-hidden flex flex-col"
                      style={{
                        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                        background: '#111111',
                      }}
                    >
                      {/* Content wrapper with blur animation */}
                      <motion.div
                        className="w-full h-full flex flex-col"
                        initial={false}
                        animate={{
                          filter: isTop ? 'blur(0px)' : 'blur(8px)',
                          opacity: isTop ? 1 : 0.7,
                        }}
                        transition={{
                          duration: 0.05,
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
                        <div className="relative w-full h-1/2 flex flex-col items-center justify-start pt-6 px-6 text-center">
                          {/* Category Title */}
                          <h3
                            className="text-white"
                            style={{
                              fontSize: '30px',
                              fontFamily: 'Outfit, sans-serif',
                              fontWeight: 500,
                              letterSpacing: '1.5px',
                              marginBottom: '12px',
                            }}
                          >
                            {cardItem.categoryTitle}
                          </h3>

                          {/* Punchy Text - 2-3 lines based on chat analysis */}
                          <p
                            className="max-w-[280px]"
                            style={{
                              fontSize: '14px',
                              fontFamily: 'Plus Jakarta Sans, sans-serif',
                              fontWeight: 200,
                              lineHeight: '1.5',
                              letterSpacing: '1.5px',
                              color: 'rgba(255, 255, 255, 0.7)',
                            }}
                          >
                            {cardItem.punchyText}
                          </p>
                        </div>
                      </motion.div>

                      {/* Darkening overlay for non-top cards */}
                      {!isTop && !isCardLocked && (
                        <div
                          className="absolute inset-0 rounded-[28px]"
                          style={{
                            backgroundColor: 'rgba(0, 0, 0, 0.15)',
                          }}
                        />
                      )}

                      {/* Lock overlay for locked cards */}
                      {isCardLocked && (
                        <div
                          className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[28px]"
                          style={{
                            background: 'rgba(0, 0, 0, 0.6)',
                            backdropFilter: 'blur(8px)',
                            WebkitBackdropFilter: 'blur(8px)',
                          }}
                        >
                          <div
                            className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl"
                            style={{
                              background: 'rgba(139, 92, 246, 0.2)',
                              border: '1px solid rgba(139, 92, 246, 0.4)',
                            }}
                          >
                            <Lock className="w-8 h-8 text-purple-300" />
                            <span className="text-white text-center" style={{ fontSize: '14px', fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '0.05em' }}>
                              Unlock Full Analysis
                            </span>
                            <span className="text-white/60 text-center" style={{ fontSize: '12px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 400 }}>
                              Tap to see {cardItem.categoryTitle}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
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
