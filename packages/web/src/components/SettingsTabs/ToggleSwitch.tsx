/**
 * The shared slider switch (extracted from `PluginsTab.tsx`'s originally-local
 * `PluginToggle` — Access-tab MCP-toggle unit — so `AccessTab.tsx` can reuse
 * the exact same Oat slider look/behavior instead of duplicating it, which
 * would trip jscpd). An iOS/macOS-style pill track (28×16) with a sliding
 * knob that animates left↔right on toggle; ON fills the track amber
 * (`--mark`, the brand's status colour), OFF is a muted `--line`-bordered
 * track.
 *
 * `role="switch"` + `aria-checked` (not a plain `aria-pressed` button) so
 * assistive tech announces it as an on/off switch. The knob + track
 * transitions are eased and honour `prefers-reduced-motion` via the shared
 * token curve.
 */
export function ToggleSwitch({
  on,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  const TRACK_W = 28;
  const TRACK_H = 16;
  const KNOB = 12;
  const INSET = (TRACK_H - KNOB) / 2; // 2px gap on every edge

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      title={
        disabled
          ? // Neutral disabled copy — a toggle can be disabled for several
            // reasons (settings loading, a mutation in flight, a feature
            // row's source master being off); the button can't tell which,
            // so avoid asserting a specific reason here.
            `${label} — unavailable`
          : on
            ? `${label} is on — click to turn off`
            : `${label} is off — click to turn on`
      }
      style={{
        position: 'relative',
        width: TRACK_W,
        height: TRACK_H,
        padding: 0,
        borderRadius: TRACK_H,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: on ? 'var(--mark)' : 'var(--bg2)',
        border: `1px solid ${on ? 'var(--mark)' : 'var(--line)'}`,
        boxSizing: 'border-box',
        transition:
          'background .18s var(--ease-out), border-color .18s var(--ease-out), opacity .15s ease',
        flex: 'none',
      }}
    >
      {/* The sliding knob — translated to the ON side; the transform is what
          reads as the smooth slide. Off-white knob so it stays legible on both
          the amber (on) and dark (off) track. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: INSET,
          left: INSET,
          width: KNOB,
          height: KNOB,
          borderRadius: '50%',
          background: on ? '#fff' : 'var(--mut)',
          transform: on ? `translateX(${TRACK_W - KNOB - INSET * 2}px)` : 'translateX(0)',
          transition: 'transform .18s var(--ease-out), background .18s var(--ease-out)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
        }}
      />
    </button>
  );
}
