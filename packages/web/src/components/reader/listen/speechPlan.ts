import type { Segment } from './segments';

/** A synthesis unit: one or more sentences merged, or a clause-split piece of a long sentence. */
export type Unit = {
  text: string;
  /** The sentences this unit covers, with their share of the text, for highlight timing. */
  parts: { seg: number; chars: number }[];
  /** Silence scheduled after the unit, in ms. */
  pause: number;
};

type Planned = Pick<Segment, 'text' | 'block' | 'kind'>;

export const HEADING_PAUSE_MS = 250;
export const BLOCK_PAUSE_MS = 150;
/** Adjacent sentences merge while either is shorter than this. */
const SHORT = 60;
const MERGE_MAX = 200;
/** A sentence longer than this is split at clause boundaries. */
const LONG = 300;
const PIECE = 220;

/** Cut text longer than `LONG` at commas and similar, then at spaces as a last resort. */
export function splitLong(text: string): string[] {
  const clauses = text.split(/(?<=[,;:—–])\s+/);
  const pieces: string[] = [];
  let current = '';
  for (const clause of clauses) {
    if (current && current.length + clause.length + 1 > PIECE) {
      pieces.push(current);
      current = clause;
    } else current = current ? `${current} ${clause}` : clause;
  }
  if (current) pieces.push(current);
  return pieces.flatMap((piece) => {
    if (piece.length <= LONG) return [piece];
    const cut: string[] = [];
    let rest = piece;
    while (rest.length > LONG) {
      const at = rest.lastIndexOf(' ', PIECE);
      cut.push(rest.slice(0, at > 0 ? at : PIECE));
      rest = rest.slice(at > 0 ? at + 1 : PIECE);
    }
    if (rest) cut.push(rest);
    return cut;
  });
}

function pauseAfter(segments: readonly Planned[], at: number): number {
  const segment = segments[at] as Planned;
  const next = segments[at + 1];
  if (segment.kind === 'heading') return HEADING_PAUSE_MS;
  return !next || next.block !== segment.block ? BLOCK_PAUSE_MS : 0;
}

function canMerge(unit: Unit, last: Planned, candidate: Planned): boolean {
  return (
    candidate.block === last.block &&
    last.kind !== 'heading' &&
    candidate.kind !== 'heading' &&
    (unit.text.length < SHORT || candidate.text.length < SHORT) &&
    unit.text.length + 1 + candidate.text.length <= MERGE_MAX
  );
}

/** Plan synthesis from a sentence onward. Headings never merge. */
export function buildUnits(segments: readonly Planned[], from: number): Unit[] {
  const units: Unit[] = [];
  for (let i = from; i < segments.length; i += 1) {
    const segment = segments[i] as Planned;
    if (segment.text.length > LONG) {
      const pieces = splitLong(segment.text);
      const pause = pauseAfter(segments, i);
      pieces.forEach((piece, k) => {
        units.push({
          text: piece,
          parts: [{ seg: i, chars: piece.length }],
          pause: k === pieces.length - 1 ? pause : 0,
        });
      });
      continue;
    }
    const unit: Unit = {
      text: segment.text,
      parts: [{ seg: i, chars: segment.text.length }],
      pause: pauseAfter(segments, i),
    };
    let last = segment;
    while (i + 1 < segments.length) {
      const candidate = segments[i + 1] as Planned;
      if (!canMerge(unit, last, candidate)) break;
      unit.text = `${unit.text} ${candidate.text}`;
      unit.parts.push({ seg: i + 1, chars: candidate.text.length });
      i += 1;
      last = candidate;
      unit.pause = pauseAfter(segments, i);
    }
    units.push(unit);
  }
  return units;
}
