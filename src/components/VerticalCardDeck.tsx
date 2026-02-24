import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageInsightCard } from './MessageInsightCard';
import { getAnalysisResult } from '../services/analysisService';
import { SkeletonCard } from './SkeletonCard';

interface VerticalCardData {
  gradientStart: string;
  gradientEnd: string;
  accentColor: string;
  title: string;
  tag: string;
  tagColor: string;
  description: string;
  message: string;
  messageCount: string;
  solution: string;
}

interface VerticalCardDeckProps {
  analysisId?: string;
  isFirstTimeFree?: boolean;
  onPaywallOpen?: () => void;
  isLoading?: boolean;
}

export function VerticalCardDeck({ analysisId, isFirstTimeFree = false, onPaywallOpen, isLoading: externalLoading }: VerticalCardDeckProps) {
  const [verticalCards, setVerticalCards] = useState<VerticalCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [stackOrder, setStackOrder] = useState<number[]>([]);
  const [flippedCards, setFlippedCards] = useState<boolean[]>([]);

  // Deal animation: callback ref + IntersectionObserver
  // (useInView doesn't work when ref starts null during skeleton phase)
  const [deckNode, setDeckNode] = useState<HTMLDivElement | null>(null);
  const [hasDealt, setHasDealt] = useState(false);

  useEffect(() => {
    if (!deckNode || hasDealt || loading || verticalCards.length === 0) return;

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
  }, [deckNode, hasDealt, loading, verticalCards.length]);

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
      console.log('[VerticalCardDeck] Fetched data:', {
        hasResult: !!analysisResult,
        messageInsightsCount: analysisResult?.messageInsights?.length,
        messageInsightsIsArray: Array.isArray(analysisResult?.messageInsights),
        messageInsights: analysisResult?.messageInsights?.map(m => ({
          title: m.title,
          message: m.message?.substring(0, 30),
          hasDescription: !!m.description,
          hasSolution: !!m.solution
        }))
      });

      if (!analysisResult) {
        console.log('[VerticalCardDeck] No analysisResult found for ID:', analysisId);
        setLoading(false);
        return;
      }

      if (!analysisResult.messageInsights || analysisResult.messageInsights.length === 0) {
        console.log('[VerticalCardDeck] No messageInsights in analysisResult - this section will be empty');
        setLoading(false);
        return;
      }

      const totalCards = analysisResult.messageInsights.length;
      const cards: VerticalCardData[] = analysisResult.messageInsights.map((insight, index) => ({
        gradientStart: insight.gradientStart || '',
        gradientEnd: insight.gradientEnd || '',
        accentColor: insight.accentColor || insight.tagColor || '#3A3A5A',
        title: insight.title,
        tag: insight.tag,
        tagColor: insight.tagColor || '#42A5F5',
        description: insight.description,
        message: insight.message,
        // Calculate correct message count based on actual number of cards
        messageCount: `${index + 1} of ${totalCards}`,
        solution: insight.solution,
      }));

      setVerticalCards(cards);
      // Stack order: last card (highest index) is on top visually
      // We want card 1 on top, so reverse the order: [3, 2, 1, 0] means card 0 is on top
      setStackOrder(cards.map((_, i) => cards.length - 1 - i));
      setFlippedCards(new Array(cards.length).fill(false));
      setLoading(false);
    }

    loadCards();
  }, [analysisId, externalLoading]);

  const moveTopToBottom = () => {
    setStackOrder((prev) => {
      const newOrder = [...prev];
      const top = newOrder.pop()!;
      newOrder.unshift(top);

      setFlippedCards((prevFlipped) => {
        const newFlipped = [...prevFlipped];
        newFlipped[top] = false;
        return newFlipped;
      });

      return newOrder;
    });
  };

  const toggleCardFlip = (cardIndex: number) => {
    setFlippedCards((prev) => {
      const newFlipped = [...prev];
      newFlipped[cardIndex] = !newFlipped[cardIndex];
      return newFlipped;
    });
  };

  const orderedCards = stackOrder.map(orderIndex => verticalCards[orderIndex]);

  // Calculate dynamic container height based on number of cards
  // Card height = 220px, each card below adds 20px offset
  // Total height = 220px (card) + (numCards - 1) * 20px (stack offset)
  const cardHeight = 220;
  const stackOffset = 20; // pixels between each card
  const totalStackHeight = orderedCards.length > 0
    ? cardHeight + (orderedCards.length - 1) * stackOffset
    : cardHeight;

  // Show skeleton when external loading (Phase 2) or internal loading
  const showSkeleton = externalLoading || loading;

  if (showSkeleton) {
    return (
      <div className="w-full max-w-md mx-auto pt-24">
        <div className="mb-8 px-[30px] text-center">
          <p className="text-white/50 uppercase mb-2" style={{ letterSpacing: '1.5px', fontSize: '16px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}>
            Message Breakdown
          </p>
          <h2 className="text-white text-3xl mb-2" style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}>
            Between The Lines
          </h2>
        </div>

        {/* Skeleton cards stack */}
        <div className="relative w-full flex items-start justify-center px-[14px]" style={{ height: '280px' }}>
          <div className="relative w-full">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute w-full"
                style={{
                  top: `${i * 20}px`,
                  zIndex: 3 - i,
                }}
                animate={{
                  scale: i === 0 ? 1 : 0.95 - i * 0.02,
                  opacity: 1 - i * 0.15,
                }}
              >
                <SkeletonCard aspectRatio="400/220" rounded="20px" />
              </motion.div>
            ))}
          </div>
        </div>

        {/* Loading hint */}
        <div className="flex justify-center" style={{ marginTop: '16px' }}>
          <motion.p
            className="text-white/50 uppercase"
            style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            Reading messages...
          </motion.p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto pt-24">
      <div className="mb-8 px-[30px] text-center">
        <p className="text-white/50 uppercase mb-2" style={{ letterSpacing: '1.5px', fontSize: '16px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200 }}>
          Message Breakdown
        </p>
        <h2 className="text-white text-3xl mb-2" style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}>
          Between The Lines
        </h2>
      </div>

      {verticalCards.length === 0 ? (
        <div className="flex flex-col items-center text-center py-12 px-[30px]">
          <p
            className="text-white/70 max-w-[280px]"
            style={{ fontSize: '15px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 300, letterSpacing: '0.5px', lineHeight: '1.6' }}
          >
            Not much to decode here — this chat is pretty straightforward.
          </p>
        </div>
      ) : (
      <>
      <div ref={setDeckNode} className="relative w-full flex items-start justify-center px-[14px]" style={{ height: `${totalStackHeight}px` }}>
        <div className="relative w-full h-full">
          <AnimatePresence initial={false}>
            {orderedCards.map((vCard, visualIndex) => {
              const isTop = visualIndex === orderedCards.length - 1;
              const distanceFromTop = (orderedCards.length - 1) - visualIndex;
              const cardDataIndex = stackOrder[visualIndex];
              const isFlipped = flippedCards[cardDataIndex];

              return (
                <MessageInsightCard
                  key={vCard.title}
                  message={vCard.message}
                  messageCount={vCard.messageCount}
                  title={vCard.title}
                  tag={vCard.tag}
                  tagColor={vCard.tagColor}
                  description={vCard.description}
                  solution={vCard.solution}
                  gradientStart={vCard.gradientStart}
                  gradientEnd={vCard.gradientEnd}
                  accentColor={vCard.accentColor}
                  isTop={isTop}
                  isFlipped={isFlipped}
                  visualIndex={visualIndex}
                  distanceFromTop={distanceFromTop}
                  cardIndex={cardDataIndex}
                  isFirstTimeFree={isFirstTimeFree}
                  onTap={() => toggleCardFlip(cardDataIndex)}
                  onSwipe={moveTopToBottom}
                  onPaywallOpen={onPaywallOpen}
                  hasDealt={hasDealt}
                  dealDelay={visualIndex * 0.1}
                />
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex items-center justify-center gap-6" style={{ marginTop: '16px' }}>
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
      </>
      )}
    </div>
  );
}
