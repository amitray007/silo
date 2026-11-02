import { useEffect, useState } from 'react';

/** The leaving label stays this long (the CSS fade-out is a little shorter). */
const LEAVE_MS = 110;

/**
 * A one-line status that crossfades when its words change: the old label drifts out as the new
 * one drifts in, and the running label shimmers. Announces the current label only.
 */
export function StatusLine({ label, className }: { label: string; className?: string }) {
  const [shown, setShown] = useState({ label, leaving: '' });
  if (shown.label !== label) setShown({ label, leaving: shown.label });
  useEffect(() => {
    if (!shown.leaving) return;
    const timer = window.setTimeout(() => setShown((now) => ({ ...now, leaving: '' })), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [shown.leaving]);
  return (
    <p role="status" className={`silo-status ${className ?? ''}`.trim()}>
      {shown.leaving && (
        <span key={`out-${shown.leaving}`} className="silo-status-out" aria-hidden="true">
          {shown.leaving}
        </span>
      )}
      <span key={label} className="silo-status-in silo-shimmer">
        {label}
      </span>
    </p>
  );
}
