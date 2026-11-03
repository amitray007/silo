import { Blocks } from 'loading-dev';
import { useEffect, useState } from 'react';

/** Loads under this long never show a spinner, so a fast load does not flash one. */
export const SPINNER_DELAY_MS = 200;

const SIZE = { inline: 14, pane: 20 } as const;

/**
 * The one loading indicator. `pane` centers in the area its container gives
 * it (with a min-height so the layout holds when content lands); `inline`
 * replaces text in place, e.g. inside a button. It announces `label` once as a
 * status and draws nothing until the delay passes.
 */
export function Spinner({
  label,
  variant = 'pane',
  delay = SPINNER_DELAY_MS,
  minHeight,
}: {
  label: string;
  variant?: 'pane' | 'inline';
  delay?: number;
  /** Pane only: the least height it holds, so the layout does not jump when content lands. */
  minHeight?: number;
}) {
  const [shown, setShown] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return;
    const timer = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  return (
    <span
      className="silo-spinner"
      data-variant={variant}
      role="status"
      style={variant === 'pane' && minHeight ? { minHeight } : undefined}
    >
      <span className="silo-sr-only">{label}</span>
      {shown && <Blocks size={SIZE[variant]} color="var(--fnt)" />}
    </span>
  );
}
