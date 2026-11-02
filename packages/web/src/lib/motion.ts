/** How long a surface takes to change shape. */
export const SPRING_MS = 280;

/**
 * A critically damped spring (it settles with no overshoot) as a CSS `linear()` easing, sampled
 * across the first seven time constants, where the step response `1 - (1 + t) e^-t` reaches 0.993.
 */
function critical(samples: number): string {
  const points = Array.from({ length: samples + 1 }, (_, index) => {
    const t = (index / samples) * 7;
    return index === samples ? '1' : (1 - (1 + t) * Math.exp(-t)).toFixed(4);
  });
  return `linear(${points.join(', ')})`;
}
export const SPRING = critical(28);

/** True when the reader asked for less motion. Movement and blur are skipped; opacity stays. */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
