/** Header stays put near the top, and a direction counts after this much net travel. */
const TOP = 48;
const TRAVEL = 8;

/**
 * Turns scroll positions into a header decision: `true` hide, `false` show,
 * `undefined` keep. Shared by Reader's own scroller and Live's view copy so
 * both modes hide and return on the same distances.
 */
export function scrollDirection(start = 0) {
  let previous = start;
  let travel = 0;
  return {
    update(rawTop: number, rawMaximum: number): boolean | undefined {
      const maximum = Math.max(0, rawMaximum);
      // Clamping keeps rubber-band overscroll from reading as a direction change.
      const top = Math.min(maximum, Math.max(0, rawTop));
      const delta = top - previous;
      previous = top;
      if (top <= TOP || maximum === 0) {
        travel = 0;
        return false;
      }
      if (delta === 0) return undefined;
      // Tiny reversals count toward net travel rather than restarting the run.
      travel =
        Math.sign(delta) === Math.sign(travel) || Math.abs(delta) <= 2 ? travel + delta : delta;
      if (Math.abs(travel) < TRAVEL) return undefined;
      const hide = travel > 0;
      travel = 0;
      return hide;
    },
    /** Take a new position as the baseline without deciding anything. */
    sync(top: number, maximum = Number.POSITIVE_INFINITY) {
      previous = Math.min(Math.max(0, maximum), Math.max(0, top));
      travel = 0;
    },
  };
}
