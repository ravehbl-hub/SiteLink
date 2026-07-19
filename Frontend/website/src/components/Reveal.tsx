import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Lightweight scroll fade-in using IntersectionObserver — dependency-free.
 * Falls back to visible if IntersectionObserver is unavailable.
 */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal ${shown ? 'reveal--in' : ''} ${className}`}>
      {children}
    </div>
  );
}
