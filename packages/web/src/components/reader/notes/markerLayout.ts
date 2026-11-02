export type MarkerSpot = {
  key: number;
  /** Where the marker wants to sit: the centre of its paragraph's first highlighted line. */
  y: number;
  /** The paragraph's line height; a marker moves down in whole lines. */
  lineHeight: number;
};

/**
 * One collision pass over everything in the gutter column. The resume button never moves; every
 * marker keeps at least `clear` pixels from it and from every marker above it, moving down in
 * whole lines of its own paragraph.
 */
export function resolveMarkerYs(
  markers: readonly MarkerSpot[],
  resumeY: number | null,
  clear: number,
): Map<number, number> {
  const placed: number[] = resumeY === null ? [] : [resumeY];
  const result = new Map<number, number>();
  for (const marker of [...markers].sort((a, b) => a.y - b.y)) {
    let y = marker.y;
    // Each push lands past the item it cleared, so the loop ends within `placed.length` rounds.
    for (let round = 0; round <= placed.length; round += 1) {
      const blocker = placed.find((other) => Math.abs(y - other) < clear);
      if (blocker === undefined) break;
      y += Math.ceil((blocker + clear - y) / marker.lineHeight) * marker.lineHeight;
    }
    placed.push(y);
    result.set(marker.key, y);
  }
  return result;
}
