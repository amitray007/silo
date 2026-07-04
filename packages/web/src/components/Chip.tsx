/**
 * Deterministic letter-chip derivation: strips a leading `www.`, takes the
 * hostname's first dot-segment, keeps only alphanumerics, and uppercases the
 * first character. No remote favicon fetch — this IS the privacy-preserving
 * replacement for a per-row favicon call (CLAUDE.md "Design fidelity").
 * Mirrors the prototype's `Component.chip()` derivation (docs/design/app/Silo-v2.html),
 * but this component surfaces a single letter per the W3 spec.
 */
export function chipLetter(domain: string | null | undefined): string {
  const segment = (
    String(domain ?? '')
      .replace(/^www\./i, '')
      .split('.')[0] ?? ''
  ).replace(/[^a-z0-9]/gi, '');
  return segment ? segment.charAt(0).toUpperCase() : '·';
}

export function Chip({ domain, size = 18 }: { domain: string | null | undefined; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: 'none',
        width: size,
        height: size,
        borderRadius: 4,
        background: 'var(--bg2)',
        border: '1px solid var(--line)',
        color: 'var(--mut)',
        fontSize: '0.5rem',
        fontWeight: 500,
        display: 'grid',
        placeItems: 'center',
        letterSpacing: '0.01em',
      }}
    >
      {chipLetter(domain)}
    </span>
  );
}
