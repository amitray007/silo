import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HighlightJson } from '../../../api/types';
import { type Anchored, type AnchorInput, anchorHighlight, anchorNearHint } from './anchor';
import type { AnchorJob, AnchorRequest, AnchorResponse, AnchorResult } from './anchoringWorker';
import { overlapPieces, type Span } from './overlap';
import { clearHighlights, type PaintedPiece, paintHighlights } from './paint';
import { buildTextMap, rangeFromOffsets, type TextMap } from './textMap';

/** A highlight found in the prose: its text span, the live range, and how it was found. */
export type ResolvedHighlight = Span & {
  highlight: HighlightJson;
  range: Range;
  how: 'offsets' | 'exact' | 'fuzzy';
};

type Cache = { root: HTMLElement; text: string; anchors: ReadonlyMap<string, Anchored | null> };
let nextVersion = 0;

/** One text version owns one worker. Highlight edits only send a new batch. */
class Resolver {
  private worker: Worker | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private batch = 0;
  private readonly version = ++nextVersion;
  private jobs: readonly AnchorJob[] = [];
  private stopped = false;

  constructor(
    private readonly text: string,
    private readonly apply: (results: AnchorResult[]) => void,
  ) {}

  private post(message: AnchorRequest) {
    this.worker?.postMessage(message);
  }

  private startWorker(): void {
    this.worker = new Worker(new URL('./anchoringWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<AnchorResponse>) => {
      if (!this.stopped && data.version === this.version && data.batch === this.batch) {
        this.apply(data.results);
      }
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      if (this.stopped) return;
      this.worker?.terminate();
      this.worker = undefined;
      this.fallback(this.jobs, this.batch);
    };
    this.post({ type: 'text', version: this.version, text: this.text });
  }

  /** jsdom and browsers without workers defer matching, one anchor per task. */
  private fallback(jobs: readonly AnchorJob[], batch: number): void {
    const results: AnchorResult[] = [];
    let at = 0;
    const step = () => {
      if (this.stopped || batch !== this.batch) return;
      const job = jobs[at++];
      if (job) results.push({ key: job.key, found: anchorHighlight(this.text, job.input) });
      if (at < jobs.length) this.timer = setTimeout(step, 0);
      else this.apply(results);
    };
    this.timer = setTimeout(step, 0);
  }

  run(jobs: readonly AnchorJob[]): void {
    if (this.stopped) return;
    this.cancel();
    this.jobs = jobs;
    if (jobs.length === 0) return;
    try {
      if (!this.worker) this.startWorker();
      this.post({ type: 'batch', version: this.version, batch: this.batch, jobs });
    } catch {
      this.worker?.terminate();
      this.worker = undefined;
      this.fallback(jobs, this.batch);
    }
  }

  cancel(): void {
    this.batch += 1;
    clearTimeout(this.timer);
    this.post({ type: 'cancel' });
  }

  dispose(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.worker?.terminate();
  }
}

function anchorKey(input: AnchorInput): string {
  return JSON.stringify([
    input.quote,
    input.prefix,
    input.suffix,
    input.startOffset,
    input.endOffset,
  ]);
}

function resolveLayer(
  map: TextMap | null,
  highlights: readonly HighlightJson[],
  cache: Cache | null,
) {
  const resolved: ResolvedHighlight[] = [];
  const orphans: HighlightJson[] = [];
  const pending = new Map<string, AnchorJob>();
  if (!map) return { resolved, orphans, jobs: [] };
  for (const highlight of highlights) {
    const key = anchorKey(highlight);
    const known = cache?.root === map.root && cache.text === map.text && cache.anchors.has(key);
    const found = anchorNearHint(map.text, highlight) || (known ? cache.anchors.get(key) : null);
    const range = found && rangeFromOffsets(map, found.start, found.end);
    if (found && range) {
      resolved.push({ ...found, id: highlight.id, color: highlight.color, highlight, range });
    } else if (known || !highlight.quote) {
      orphans.push(highlight);
    } else {
      // Pending anchors are not orphans until the full matcher has ruled them out.
      const { quote, prefix, suffix, startOffset, endOffset } = highlight;
      pending.set(key, { key, input: { quote, prefix, suffix, startOffset, endOffset } });
    }
  }
  resolved.sort((a, b) => a.start - b.start || a.end - b.end);
  return { resolved, orphans, jobs: [...pending.values()] };
}

/** Keep global/fuzzy results for this map while newer batches are pending. */
function useAnchors(map: TextMap | null, highlights: readonly HighlightJson[]) {
  const [cache, setCache] = useState<Cache | null>(null);
  const resolver = useRef<Resolver | null>(null);
  const root = map?.root;
  const text = map?.text;
  useEffect(() => {
    if (!root || text === undefined) {
      setCache(null);
      return;
    }
    setCache((previous) => (previous?.root === root && previous.text === text ? previous : null));
    const current = new Resolver(text, (results) => {
      setCache((previous) => {
        const anchors = new Map(
          previous?.root === root && previous.text === text ? previous.anchors : [],
        );
        for (const { key, found } of results) anchors.set(key, found);
        return { root, text, anchors };
      });
    });
    resolver.current = current;
    return () => {
      current.dispose();
      resolver.current = null;
    };
  }, [root, text]);

  const layer = useMemo(() => resolveLayer(map, highlights, cache), [map, highlights, cache]);
  const jobsKey = JSON.stringify(layer.jobs);
  useEffect(() => {
    const current = resolver.current;
    if (map) current?.run(JSON.parse(jobsKey) as AnchorJob[]);
    return () => current?.cancel();
  }, [jobsKey, map]);
  return { layer, resolver };
}

/** Paint immediate anchors now; merge full matches only into their originating text map. */
export function useHighlightLayer(prose: HTMLElement | null, highlights: readonly HighlightJson[]) {
  const [storedMap, setMap] = useState<TextMap | null>(null);
  const map = storedMap?.root === prose ? storedMap : null;
  const { layer, resolver } = useAnchors(map, highlights);
  useLayoutEffect(() => {
    if (!prose) {
      setMap(null);
      return;
    }
    setMap(buildTextMap(prose));
    let frame = 0;
    const observer = new MutationObserver(() => {
      // Invalidate before the coalesced rebuild, so a reply cannot paint a changed DOM.
      resolver.current?.cancel();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMap(buildTextMap(prose)));
    });
    observer.observe(prose, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [prose, resolver]);

  useLayoutEffect(() => {
    const pieces: PaintedPiece[] = [];
    for (const piece of overlapPieces(layer.resolved)) {
      const range = map && rangeFromOffsets(map, piece.start, piece.end);
      if (range) pieces.push({ ...piece, range });
    }
    paintHighlights(layer.resolved, pieces);
  }, [layer, map]);

  useEffect(() => clearHighlights, []);
  return { map, resolved: layer.resolved, orphans: layer.orphans };
}
