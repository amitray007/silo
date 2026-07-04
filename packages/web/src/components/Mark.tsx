export type MarkKind = 'note' | 'claude' | 'enriching' | 'degraded';

interface MarkSpec {
  glyph: string;
  color: string;
  label: string;
  animate: boolean;
}

/**
 * The four Oat marks (CLAUDE.md "Design fidelity"). There is deliberately NO
 * `full`/healthy variant — "silence means complete": callers simply don't
 * render a Mark when a link is healthy.
 */
const SPECS: Record<MarkKind, MarkSpec> = {
  note: { glyph: '¶', color: 'var(--markt)', label: 'has a note', animate: false },
  claude: { glyph: '◆', color: 'var(--ghost)', label: 'added by Claude', animate: false },
  enriching: { glyph: '◌', color: 'var(--markt)', label: 'capturing…', animate: true },
  degraded: { glyph: '◌', color: 'var(--warn)', label: 'capture incomplete', animate: false },
};

export function Mark({ kind }: { kind: MarkKind }) {
  const spec = SPECS[kind];
  return (
    <span
      role="img"
      aria-label={spec.label}
      title={spec.label}
      style={{
        color: spec.color,
        fontSize: '0.84rem',
        lineHeight: 1,
        display: 'inline-block',
        animation: spec.animate ? 'siloPulse 1.6s ease-in-out infinite' : undefined,
      }}
    >
      {spec.glyph}
    </span>
  );
}
