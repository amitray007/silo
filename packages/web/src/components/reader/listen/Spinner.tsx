import { Blocks } from 'loading-dev';
import { useEffect, useState } from 'react';

/** True once `on` has held for `ms`, so fast transitions never flash a spinner. */
export function useDelayed(on: boolean, ms = 150): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && shown;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className="silo-listen-spinner" aria-hidden="true">
      <Blocks size={size} color="currentColor" />
    </span>
  );
}
