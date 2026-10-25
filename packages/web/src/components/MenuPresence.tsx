import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';

const ClosingContext = createContext(false);
export function useMenuClosing() {
  return useContext(ClosingContext);
}

/** Retain closing menus for their 100ms fade, with interaction disabled immediately. */
export function MenuPresence({ children }: { children: ReactNode }) {
  const present = Boolean(children);
  const previous = useRef(children);
  const [mounted, setMounted] = useState(present);
  if (present) previous.current = children;
  if (present && !mounted) setMounted(true);
  useEffect(() => {
    if (present) return;
    const timer = setTimeout(() => setMounted(false), 100);
    return () => clearTimeout(timer);
  }, [present]);
  if (!present && !mounted) return null;
  return (
    <ClosingContext.Provider value={!present}>
      <span
        className="silo-menu-presence"
        data-closing={!present}
        aria-hidden={!present || undefined}
        inert={!present}
      >
        {present ? children : previous.current}
      </span>
    </ClosingContext.Provider>
  );
}
