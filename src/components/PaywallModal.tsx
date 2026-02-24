import { useState, useEffect } from 'react';
import { X, Check, Loader2, MessageCircle, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type PlanType = 'annual' | 'monthly' | 'single';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubscribe: (plan: 'annual' | 'monthly') => Promise<void>;
  onSingleUnlock: () => Promise<void>;
  canUseSingleUnlock: boolean;
  singleUnlocksRemaining: number;
  isFirstAnalysis?: boolean;
  showSingleUnlock?: boolean;
}

export function PaywallModal({
  isOpen,
  onClose,
  onSubscribe,
  onSingleUnlock,
  canUseSingleUnlock,
  singleUnlocksRemaining,
  isFirstAnalysis = false,
  showSingleUnlock = false
}: PaywallModalProps) {
  const [billingPeriod, setBillingPeriod] = useState<'annual' | 'monthly'>('annual');
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('annual');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selectedPlan with billingPeriod toggle
  const handleBillingToggle = (period: 'annual' | 'monthly') => {
    setBillingPeriod(period);
    if (selectedPlan !== 'single') {
      setSelectedPlan(period);
    }
  };

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCTA = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (selectedPlan === 'single') {
        await onSingleUnlock();
      } else {
        await onSubscribe(selectedPlan);
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getCTAText = () => {
    if (isLoading) return 'Loading...';
    switch (selectedPlan) {
      case 'annual': return 'Start free trial';
      case 'monthly': return 'Unlock now';
      case 'single': return 'Unlock this chat';
    }
  };

  const getReassuranceText = () => {
    if (selectedPlan === 'annual') return 'No charge today.';
    return 'Private. No chat stored.';
  };

  return (
    <AnimatePresence>
      {/* Container - centered vertically, no scroll */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop with glassmorphism */}
        <motion.div
          initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: 1, backdropFilter: 'blur(16px)' }}
          exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 bg-black/60"
          style={{
            WebkitBackdropFilter: 'blur(16px)',
          }}
          onClick={onClose}
        />

        {/* Modal - fade from center with scale and blur */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="relative w-full max-w-md bg-[#0a0a0a] rounded-[32px] overflow-hidden border border-white/10 mx-4 overflow-y-auto"
          style={{ maxHeight: 'calc(100vh - 80px)' }}
        >
          {/* Close button */}
          <div className="relative pt-4 pr-4 flex justify-end">
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            >
              <X className="w-5 h-5 text-white/50" />
            </button>
          </div>

          {/* Content area */}
          <div className="px-6 pb-8 pt-2">
            {/* B) HEADLINE + SUBHEADLINE */}
            <div className="text-center mb-3">
              {/* Purple checkmark icon */}
              <div className="flex justify-center mb-3">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #7200B4 0%, #4A0075 100%)',
                    boxShadow: '0 4px 20px rgba(114, 0, 180, 0.4)'
                  }}
                >
                  <Check className="w-7 h-7 text-white" strokeWidth={3} />
                </div>
              </div>
              <h2
                className="text-[26px] font-bold text-white"
                style={{ fontFamily: 'Outfit, sans-serif' }}
              >
                Unlock Unlimited Access
              </h2>
            </div>

            {/* C) BULLET POINTS */}
            <div className="space-y-3 mt-5 mb-10">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-3.5 h-3.5 text-white/70" />
                </div>
                <p className="text-white text-sm font-medium" style={{ fontFamily: 'Outfit, sans-serif' }}>
                  Unlimited Chats
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Users className="w-3.5 h-3.5 text-white/70" />
                </div>
                <p className="text-white text-sm font-medium" style={{ fontFamily: 'Outfit, sans-serif' }}>
                  Connections <span className="text-white/40 font-normal">(Unlock Guys' Profiles)</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                  <img src="/Soul.png" alt="" className="w-4 h-4 opacity-70" />
                </div>
                <p className="text-white text-sm font-medium" style={{ fontFamily: 'Outfit, sans-serif' }}>
                  My Soul <span className="text-white/40 font-normal">(The real you, unfiltered)</span>
                </p>
              </div>
            </div>

            {/* D) BILLING TOGGLE + PLAN SELECTOR */}
            <div className="space-y-4 mb-5">
              {/* iOS-style Toggle with Labels */}
              <div className="flex items-center justify-center gap-3 mb-2">
                <span
                  className={`text-sm font-medium transition-colors ${
                    billingPeriod === 'annual' ? 'text-white' : 'text-white/40'
                  }`}
                  style={{ fontFamily: 'Outfit, sans-serif' }}
                >
                  Annual
                </span>

                {/* iOS Toggle Switch */}
                <button
                  onClick={() => handleBillingToggle(billingPeriod === 'annual' ? 'monthly' : 'annual')}
                  className="relative w-[44px] h-[24px] rounded-full transition-colors"
                  style={{
                    backgroundColor: billingPeriod === 'annual' ? '#7200B4' : 'rgba(255,255,255,0.2)'
                  }}
                >
                  <motion.div
                    className="absolute top-[2px] w-[20px] h-[20px] bg-white rounded-full shadow-md"
                    initial={false}
                    animate={{
                      left: billingPeriod === 'annual' ? 2 : 22
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                </button>

                <span
                  className={`text-sm font-medium transition-colors ${
                    billingPeriod === 'monthly' ? 'text-white' : 'text-white/40'
                  }`}
                  style={{ fontFamily: 'Outfit, sans-serif' }}
                >
                  Monthly
                </span>
              </div>

              {/* Subscription Plan Card - Changes based on toggle with animations */}
              <button
                onClick={() => setSelectedPlan(billingPeriod)}
                className={`w-full px-4 py-5 rounded-2xl border relative transition-colors duration-300 ${
                  selectedPlan === billingPeriod
                    ? billingPeriod === 'annual'
                      ? 'border-[#7200B4]/40 bg-[#7200B4]/15'
                      : 'border-white/40 bg-white/10'
                    : billingPeriod === 'annual'
                      ? 'border-[#7200B4]/30 bg-[#7200B4]/10'
                      : 'border-white/10 bg-white/5'
                }`}
              >
                {/* Best Value Badge - only show for annual */}
                <AnimatePresence>
                  {billingPeriod === 'annual' && (
                    <motion.div
                      initial={{ opacity: 0, y: 5, filter: 'blur(8px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, y: 5, filter: 'blur(8px)' }}
                      transition={{ duration: 0.18 }}
                      className="absolute -top-3 left-4 px-2 py-0.5 bg-white rounded-full"
                    >
                      <span className="text-[10px] font-bold text-black uppercase tracking-wide">Most Popular</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex justify-between items-center pr-8">
                  {/* Left side - Title and subtitle */}
                  <div className="text-left">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={billingPeriod}
                        initial={{ opacity: 0, filter: 'blur(8px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, filter: 'blur(8px)' }}
                        transition={{ duration: 0.15 }}
                      >
                        <p className="text-white font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
                          {billingPeriod === 'annual' ? 'Annual' : 'Monthly'}
                        </p>
                        {billingPeriod === 'annual' ? (
                          <p className="text-[#A855F7] text-xs mt-1" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                            7-day free trial
                          </p>
                        ) : (
                          <p className="text-white/20 text-[10px]" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                            Cancel anytime.
                          </p>
                        )}
                      </motion.div>
                    </AnimatePresence>
                    {/* Cancel before day 7 - CSS grid height animation */}
                    <div
                      className="grid transition-all duration-300 ease-out"
                      style={{
                        gridTemplateRows: billingPeriod === 'annual' ? '1fr' : '0fr'
                      }}
                    >
                      <div className="overflow-hidden">
                        <p
                          className="text-white/20 text-[10px] pt-1"
                          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                        >
                          Cancel before day 7.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Right side - Price info with grid height animation */}
                  <div className="text-right flex flex-col justify-center">
                    {/* Main price - always visible */}
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={billingPeriod}
                        initial={{ opacity: 0, filter: 'blur(8px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, filter: 'blur(8px)' }}
                        transition={{ duration: 0.15 }}
                        className="flex items-baseline gap-1 justify-end"
                      >
                        <span className="text-white font-bold" style={{ fontFamily: 'Outfit, sans-serif' }}>
                          {billingPeriod === 'annual' ? '$3.33' : '$4.99'}
                        </span>
                        <span className="text-white/30 text-xs">/month</span>
                      </motion.div>
                    </AnimatePresence>

                    {/* Extra annual info - grid height animation */}
                    <div
                      className="grid transition-all duration-300 ease-out"
                      style={{
                        gridTemplateRows: billingPeriod === 'annual' ? '1fr' : '0fr'
                      }}
                    >
                      <div className="overflow-hidden">
                        <div className="text-white/30 text-[10px] text-right mt-0.5">
                          Billed yearly
                        </div>
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <Check className="w-3 h-3 text-green-400" />
                          <span className="text-green-400 text-xs font-medium">4 months free</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Selection indicator */}
                <div className={`absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selectedPlan === billingPeriod ? 'border-white bg-white' : 'border-white/30'
                }`}>
                  {selectedPlan === billingPeriod && <Check className="w-3 h-3 text-black" />}
                </div>
              </button>

              {/* Or divider + Single Unlock */}
              {showSingleUnlock && (
                <>
                  <div className="flex items-center gap-3 -my-1">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-white/40 text-sm font-medium" style={{ fontFamily: 'Outfit, sans-serif' }}>or</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>

                  {/* Single Unlock */}
                  <button
                    onClick={() => canUseSingleUnlock && setSelectedPlan('single')}
                    disabled={!canUseSingleUnlock}
                    className={`w-full p-4 rounded-2xl border transition-all relative ${
                      selectedPlan === 'single'
                        ? 'border-white/40 bg-white/10'
                        : 'border-white/10 bg-white/5'
                    } ${!canUseSingleUnlock ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center justify-between pr-8">
                      <div className="text-left">
                        <p className="text-white font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
                          Unlock this chat
                        </p>
                        <p className="text-white/20 text-[10px] mt-1" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                          One read only.
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-white font-bold" style={{ fontFamily: 'Outfit, sans-serif' }}>
                          $1.99
                        </span>
                      </div>
                    </div>

                    {/* Selection indicator */}
                    <div className={`absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      selectedPlan === 'single' ? 'border-white bg-white' : 'border-white/30'
                    }`}>
                      {selectedPlan === 'single' && <Check className="w-3 h-3 text-black" />}
                    </div>
                  </button>
                </>
              )}
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            {/* E) CTA BUTTON */}
            <button
              onClick={handleCTA}
              disabled={isLoading}
              className="w-full py-4 rounded-full font-semibold transition-all active:scale-[0.98] disabled:opacity-70 uppercase tracking-wide text-white"
              style={{
                fontFamily: 'Outfit, sans-serif',
                fontSize: '14px',
                background: selectedPlan === 'annual' ? '#7200B4' : '#FFFFFF',
                color: selectedPlan === 'annual' ? '#FFFFFF' : '#000000',
                boxShadow: selectedPlan === 'annual'
                  ? '0 8px 32px rgba(114, 0, 180, 0.3)'
                  : '0 8px 32px rgba(255, 255, 255, 0.15)'
              }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Loading...
                </span>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.span
                    key={selectedPlan}
                    initial={{ opacity: 0, filter: 'blur(8px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(8px)' }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center justify-center gap-2"
                  >
                    {getCTAText()}
                  </motion.span>
                </AnimatePresence>
              )}
            </button>

            {/* Reassurance text */}
            <AnimatePresence mode="wait">
              <motion.p
                key={selectedPlan === 'annual' ? 'annual' : 'other'}
                initial={{ opacity: 0, filter: 'blur(8px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, filter: 'blur(8px)' }}
                transition={{ duration: 0.15 }}
                className="text-center text-white/25 text-xs mt-3"
                style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
              >
                {getReassuranceText()}
              </motion.p>
            </AnimatePresence>

          </div>
        </motion.div>
      </div>

      {/* Shimmer animation keyframes */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </AnimatePresence>
  );
}
