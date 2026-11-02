/** The one surface over a selection: a bar, which becomes a composer, which becomes an answer card. */
export type SurfacePhase = 'bar' | 'composer' | 'answer';

/** The bar sits 12px above a selection, or 14px below it when there is no room above. */
const FLIP_BELOW = 70;
const GAP = 12;
const FLIP_GAP = 14;
const EDGE = 16;
const MIN_CARD_HEIGHT = 160;
const WIDTH: Record<SurfacePhase, number> = { bar: 340, composer: 384, answer: 448 };
/** Room a phase needs on its side of the passage before it grows the other way. */
const NEED: Record<SurfacePhase, number> = { bar: 0, composer: 140, answer: 320 };

export type SurfacePlacement = {
  /** The surface sits below the passage and grows down. */
  flip: boolean;
  /** Horizontal centre, kept inside the window. */
  left: number;
  /** The edge nearest the passage: the bottom edge above it, the top edge below it. */
  top: number;
  /** The tallest an answer card may grow here; 0 for the bar. */
  maxHeight: number;
};

/**
 * Where the surface sits for a passage. Each phase grows away from the passage, and stays on the
 * side the bar chose unless the room there is short, so the surface never jumps mid-morph.
 */
export function surfacePlacement(rect: DOMRect, phase: SurfacePhase): SurfacePlacement {
  const half = Math.min(WIDTH[phase], window.innerWidth - 32) / 2;
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, half + 16),
    window.innerWidth - half - 16,
  );
  const barBelow = rect.top < FLIP_BELOW;
  if (phase === 'bar')
    return {
      flip: barBelow,
      left,
      top: barBelow ? rect.bottom + FLIP_GAP : rect.top - GAP,
      maxHeight: 0,
    };
  const above = rect.top - GAP - EDGE;
  const below = window.innerHeight - rect.bottom - FLIP_GAP - EDGE;
  const need = NEED[phase];
  const up = barBelow ? !(below >= need || below >= above) : above >= need || above >= below;
  return {
    flip: !up,
    left,
    top: up ? rect.top - GAP : rect.bottom + FLIP_GAP,
    maxHeight: Math.max(MIN_CARD_HEIGHT, up ? above : below),
  };
}
