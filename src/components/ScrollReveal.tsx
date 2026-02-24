import { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ScrollReveal({ children, className, style }: ScrollRevealProps) {
  return (
    <motion.div
      className={className}
      style={{ ...style, willChange: 'filter, transform, opacity' }}
      initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }}
      whileInView={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </motion.div>
  );
}
