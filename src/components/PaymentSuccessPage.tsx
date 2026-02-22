import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { verifyPaymentSuccess } from '../services/stripeService';
import { CreateAccountPage } from './CreateAccountPage';

interface PaymentSuccessPageProps {
  onComplete: (analysisId?: string) => void;
}

export function PaymentSuccessPage({ onComplete }: PaymentSuccessPageProps) {
  const [status, setStatus] = useState<'verifying' | 'success' | 'create_account' | 'error'>('verifying');
  const [paymentType, setPaymentType] = useState<'subscription' | 'single_unlock' | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [stripeSessionId, setStripeSessionId] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  useEffect(() => {
    verifyPayment();
  }, []);

  async function verifyPayment() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    const guest = urlParams.get('guest') === 'true';
    const analysis = urlParams.get('analysis');

    setIsGuest(guest);
    setStripeSessionId(sessionId);
    setAnalysisId(analysis);

    if (!sessionId) {
      setStatus('error');
      return;
    }

    try {
      const result = await verifyPaymentSuccess(sessionId);

      if (result.success) {
        setPaymentType(result.type);

        if (guest) {
          // Guest user: show account creation after payment
          setStatus('create_account');
        } else {
          setStatus('success');
          // Redirect after showing success message
          setTimeout(() => {
            onComplete(analysis || undefined);
          }, 2500);
        }
      } else {
        setStatus('error');
      }
    } catch (err) {
      console.error('Payment verification error:', err);
      setStatus('error');
    }
  }

  function handleAccountCreated() {
    // Guest has created their account - transition to app
    window.history.replaceState({}, '', '/');
    onComplete(analysisId || undefined);
  }

  // Show CreateAccountPage for guests after payment
  if (status === 'create_account') {
    return (
      <CreateAccountPage
        stripeSessionId={stripeSessionId || undefined}
        analysisId={analysisId || undefined}
        onAccountCreated={handleAccountCreated}
      />
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center max-w-md"
      >
        {status === 'verifying' && (
          <>
            <Loader2 className="w-16 h-16 text-purple-500 animate-spin mx-auto mb-6" />
            <h1 className="text-2xl mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
              Verifying payment...
            </h1>
            <p className="text-white/60">
              Please wait
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', bounce: 0.5 }}
            >
              <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-6" />
            </motion.div>
            <h1 className="text-2xl mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
              Payment complete!
            </h1>
            <p className="text-white/60 mb-4">
              {paymentType === 'subscription' ? (
                <>Welcome to Toxic+ Unlimited! You now have unlimited access to all analyses.</>
              ) : (
                <>Your analysis has been unlocked!</>
              )}
            </p>
            <p className="text-white/40 text-sm">
              Redirecting...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
            <h1 className="text-2xl mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
              Something went wrong
            </h1>
            <p className="text-white/60 mb-6">
              We couldn't verify your payment. If you were charged, please contact us.
            </p>
            <button
              onClick={() => onComplete()}
              className="bg-white text-black px-6 py-3 rounded-full font-medium hover:bg-white/90 transition-colors"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Back to app
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
