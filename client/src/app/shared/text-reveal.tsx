import type { Key, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from './utils';

const revealSpring = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 34,
};

export function TextReveal({
  children,
  revealKey,
  className,
}: {
  children: ReactNode;
  revealKey: Key;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex min-w-0', className)}
      aria-live="polite"
      aria-atomic="true"
    >
      <AnimatePresence mode="popLayout">
        <motion.span
          key={revealKey}
          layout
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: 'auto' }}
          exit={{ opacity: 0, width: 0 }}
          transition={revealSpring}
          className="inline-block overflow-hidden whitespace-nowrap"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
