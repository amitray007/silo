import type { CSSProperties } from 'react';

/** Decorative loading block; the parent owns the loading announcement. */
export function Skeleton({
  width = '100%',
  height,
  radius = 8,
  style,
}: {
  /** Block width — a number (px) or any CSS length/percent. Defaults to filling the container. */
  width?: number | string;
  /** Block height in px. Required — a skeleton must reserve the real content's vertical space so nothing shifts when it lands. */
  height: number;
  /** Corner radius in px (default 8, matching the app's field/row radius). */
  radius?: number;
  /** Optional extra style merged last (e.g. `marginBottom` for stacked rows). */
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'var(--hov)',
        animation: 'siloPulse 1.6s ease-in-out infinite',
        ...style,
      }}
    />
  );
}
