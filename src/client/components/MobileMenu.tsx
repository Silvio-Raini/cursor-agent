import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export function MobileMenu({ children }: Props) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.open) return;
      if (ref.current.contains(e.target as Node)) return;
      ref.current.open = false;
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return (
    <details ref={ref} className="header-menu-mobile">
      <summary className="icon-btn" aria-label="Menü">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </summary>
      <div className="header-menu-dropdown" onClick={() => { if (ref.current) ref.current.open = false; }}>
        {children}
      </div>
    </details>
  );
}
