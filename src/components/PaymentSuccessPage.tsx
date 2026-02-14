import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { verifyPaymentSuccess } from '../services/stripeService';

interface PaymentSuccessPageProps {
  onComplete: (analysisId?: string) => void;
}

export function PaymentSuccessPage({ onComplete }: PaymentSuccessPageProps) {
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [paymentType, setPaymentType] = useState<'subscription' | 'single_unlock' | null>(null);

  useEffect(() => {
    verifyPayment();
  }, []);

  async function verifyPayment() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    const type = urlParams.get('type');
    const analysisId = urlParams.get('analysis');

    if (!sessionId) {
      setStatus('error');
      return;
    }

    try {
      const result = await verifyPaymentSuccess(sessionId);

      if (result.success) {
        setStatus('success');
        setPaymentType(result.type);

        // Redirect after showing success message
        setTimeout(() => {
          onComplete(analysisId || undefined);
        }, 2500);
      } else {
        setStatus('error');
      }
    } catch (err) {
      console.error('Payment verification error:', err);
      setStatus('error');
    }
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
              Verificando il pagamento...
            </h1>
            <p className="text-white/60">
              Attendere prego
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
              Pagamento completato!
            </h1>
            <p className="text-white/60 mb-4">
              {paymentType === 'subscription' ? (
                <>Benvenuta in Toxic+ Unlimited! Ora hai accesso illimitato a tutte le analisi.</>
              ) : (
                <>L'analisi è stata sbloccata con successo!</>
              )}
            </p>
            <p className="text-white/40 text-sm">
              Reindirizzamento in corso...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
            <h1 className="text-2xl mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
              Qualcosa è andato storto
            </h1>
            <p className="text-white/60 mb-6">
              Non siamo riusciti a verificare il pagamento. Se ti è stato addebitato l'importo, contattaci.
            </p>
            <button
              onClick={() => onComplete()}
              className="bg-white text-black px-6 py-3 rounded-full font-medium hover:bg-white/90 transition-colors"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Torna all'app
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
