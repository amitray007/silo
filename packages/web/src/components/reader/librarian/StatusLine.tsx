import { useEffect, useState } from 'react';

/** The leaving label stays this long (the CSS fade-out is a little shorter). */
const LEAVE_MS = 110;

/**
 * A one-line status that crossfades when its words change: the old label drifts out as the new
 * one drifts in, and the running label shimmers. `announce` makes it a live region that reads
 * the current label; the chat thread leaves it off and announces once per turn instead.
 */
export function StatusLine({
  label,
  className,
  announce = false,
}: {
  label: string;
  className?: string;
  announce?: boolean;
}) {
  const [shown, setShown] = useState({ label, leaving: '' });
  if (shown.label !== label) setShown({ label, leaving: shown.label });
  useEffect(() => {
    if (!shown.leaving) return;
    const timer = window.setTimeout(() => setShown((now) => ({ ...now, leaving: '' })), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [shown.leaving]);
  return (
    <p role={announce ? 'status' : undefined} className={`silo-status ${className ?? ''}`.trim()}>
      {shown.leaving && (
        <span key={`out-${shown.leaving}`} className="silo-status-out" aria-hidden="true">
          {shown.leaving}
        </span>
      )}
      <span key={label} className="silo-status-in">
        <span className="silo-shimmer">{label}</span>
      </span>
    </p>
  );
}
