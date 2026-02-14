import { motion } from 'framer-motion';

export type TabId = 'analyze' | 'connections' | 'soul';

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

// Individual sizes to visually balance each icon
const tabs: { id: TabId; label: string; icon: string; size: number }[] = [
  { id: 'analyze', label: 'Analyze', icon: '/chasdasdat (1).png', size: 24 },
  { id: 'connections', label: 'Connections', icon: '/Connections.png', size: 32 },
  { id: 'soul', label: 'My Soul', icon: '/Soul.png', size: 54 },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 0%, rgba(0, 0, 0, 0.88) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: '0 -4px 30px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      }}
    >
      {/* Black overlay */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0, 0, 0, 0.4)', pointerEvents: 'none' }}
      />
      <div className="relative flex items-center justify-evenly h-[80px] w-full px-5 py-3">
        {tabs.map(({ id, label, icon, size }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className="flex flex-col items-center justify-center gap-1 h-full"
              style={{ minWidth: '80px' }}
            >
              <motion.div
                className="w-[36px] h-[36px] flex items-center justify-center"
                animate={{
                  scale: isActive ? 1 : 0.9,
                }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <motion.img
                  src={icon}
                  alt={label}
                  animate={{
                    opacity: isActive ? 1 : 0.4,
                    filter: isActive ? 'brightness(1)' : 'brightness(0.8)',
                  }}
                  transition={{ duration: 0.2 }}
                  style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    objectFit: 'contain',
                  }}
                />
              </motion.div>
              <motion.span
                animate={{
                  opacity: isActive ? 1 : 0.4,
                }}
                transition={{ duration: 0.2 }}
                style={{
                  fontSize: '12px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px',
                  fontWeight: isActive ? 600 : 400,
                  color: 'white',
                }}
              >
                {label}
              </motion.span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
