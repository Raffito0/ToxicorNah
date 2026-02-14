import { motion } from 'framer-motion';

interface SigilIconProps {
  hasNew: boolean;
  count: number;
  priority: 'gold' | 'silver' | null;
  onClick: () => void;
}

export function SigilIcon({ hasNew, count, priority, onClick }: SigilIconProps) {
  // Badge colors - always matching avatar circle color #A855F7
  const badgeColor = '#A855F7';
  const glowColor = 'rgba(168, 85, 247, 0.5)';

  return (
    <motion.button
      onClick={onClick}
      className="relative w-10 h-10 flex items-center justify-center"
      whileTap={{ scale: 0.95 }}
    >
      {/* Sigil Icon - Eye/Seal design */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-white/60"
      >
        {/* Outer circle */}
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
        {/* Inner eye shape */}
        <path
          d="M12 7C8.5 7 5.5 9.5 4 12C5.5 14.5 8.5 17 12 17C15.5 17 18.5 14.5 20 12C18.5 9.5 15.5 7 12 7Z"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
        {/* Center dot */}
        <circle
          cx="12"
          cy="12"
          r="2"
          fill="currentColor"
        />
        {/* Top mark */}
        <line
          x1="12"
          y1="2"
          x2="12"
          y2="4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Bottom mark */}
        <line
          x1="12"
          y1="20"
          x2="12"
          y2="22"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>

      {/* Badge dot */}
      {hasNew && (
        <motion.div
          className="absolute -top-0.5 -right-0.5 flex items-center justify-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
        >
          {/* Main dot */}
          <motion.div
            className="relative rounded-full flex items-center justify-center"
            style={{
              width: count > 1 ? '16px' : '8px',
              height: count > 1 ? '16px' : '8px',
              background: badgeColor,
            }}
            animate={{
              opacity: [0.8, 1, 0.8],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            {/* Count number (only if > 1) */}
            {count > 1 && (
              <span
                className="text-white"
                style={{ fontSize: '9px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
              >
                {count}
              </span>
            )}
          </motion.div>
        </motion.div>
      )}
    </motion.button>
  );
}
