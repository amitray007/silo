import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { HighlightJson } from '../../../api/types';
import { anchorHighlight } from './anchor';
import { overlapPieces, type Span } from './overlap';
import { clearHighlights, type PaintedPiece, paintHighlights } from './paint';
import { buildTextMap, rangeFromOffsets, type TextMap } from './textMap';

/** A highlight found in the prose: its text span, the live range, and how it was found. */
export type ResolvedHighlight = Span & {
  highlight: HighlightJson;
  range: Range;
  how: 'offsets' | 'exact' | 'fuzzy';
};

/**
 * Anchor every stored highlight in the prose and paint it with the CSS Custom Highlight API, so
 * no DOM is wrapped. A highlight whose passage is gone is an orphan: kept, listed, not painted.
 * The map rebuilds when the prose element changes (a new capture) and when its text changes
 * (late code highlighting). Type settings only move the text around, and the ranges follow.
 */
export function useHighlightLayer(prose: HTMLElement | null, highlights: readonly HighlightJson[]) {
  const [map, setMap] = useState<TextMap | null>(null);
  useLayoutEffect(() => {
    if (!prose) {
      setMap(null);
      return;
    }
    setMap(buildTextMap(prose));
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMap(buildTextMap(prose)));
    });
    observer.observe(prose, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [prose]);

  const layer = useMemo(() => {
    const resolved: ResolvedHighlight[] = [];
    const orphans: HighlightJson[] = [];
    if (!map) return { resolved, orphans };
    for (const highlight of highlights) {
      const found = anchorHighlight(map.text, highlight);
      const range = found && rangeFromOffsets(map, found.start, found.end);
      if (found && range) {
        resolved.push({
          id: highlight.id,
          color: highlight.color,
          start: found.start,
          end: found.end,
          how: found.how,
          highlight,
          range,
        });
      } else orphans.push(highlight);
    }
    resolved.sort((a, b) => a.start - b.start || a.end - b.end);
    return { resolved, orphans };
  }, [map, highlights]);

  useLayoutEffect(() => {
    const pieces: PaintedPiece[] = [];
    for (const piece of overlapPieces(layer.resolved)) {
      const range = map && rangeFromOffsets(map, piece.start, piece.end);
      if (range) pieces.push({ ...piece, range });
    }
    // Repainting replaces the colour sets; the pulse and hover highlights are left alone.
    paintHighlights(layer.resolved, pieces);
  }, [layer, map]);

  // Everything goes when the reader leaves or another article opens.
  useEffect(() => clearHighlights, []);

  return { map, resolved: layer.resolved, orphans: layer.orphans };
}
