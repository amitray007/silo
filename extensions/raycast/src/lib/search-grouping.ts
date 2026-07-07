import type { CapturedLink } from './types.js';

/** A results section, grouped by capture day — mirrors the reference UI's "Today"/date headers and the web app's `Today / Yesterday / This week / Earlier` day labels (`docs/design/tokens.md`). */
export type SearchSection = {
  title: string;
  links: CapturedLink[];
};

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(createdAt: Date, now: Date): string {
  const diffDays = Math.round((startOfDay(now) - startOfDay(createdAt)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays <= 7) return 'This week';
  return 'Earlier';
}

const SECTION_ORDER = ['Today', 'Yesterday', 'This week', 'Earlier'];

/** Groups search results into day-labeled sections, in `SECTION_ORDER` (results already arrive rank-ordered from the API within each group). */
export function groupByDay(links: CapturedLink[], now = new Date()): SearchSection[] {
  const buckets = new Map<string, CapturedLink[]>();
  for (const link of links) {
    const label = dayLabel(new Date(link.createdAt), now);
    const bucket = buckets.get(label) ?? [];
    bucket.push(link);
    buckets.set(label, bucket);
  }
  const sections: SearchSection[] = [];
  for (const label of SECTION_ORDER) {
    const bucket = buckets.get(label);
    if (bucket) sections.push({ title: label, links: bucket });
  }
  return sections;
}
