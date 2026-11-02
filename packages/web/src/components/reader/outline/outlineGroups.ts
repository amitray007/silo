/** The most ticks the rail ever holds. */
export const MAX_TICKS = 40;

export type OutlineSection = { el: Element; heading: boolean };

export type OutlineGroup = {
  id: number;
  sections: OutlineSection[];
  /** The group's heading, when it holds one. */
  heading: OutlineSection | undefined;
  /** The heading's text, or the first sentence of the lead paragraph. */
  title: string;
  /** Muted lines under the title: the paragraph's rest, or the text under a heading. */
  body: string;
};

/** Paragraph-level blocks of the article in order, without ones nested in another block. */
export function collectSections(prose: HTMLElement): OutlineSection[] {
  const sections: OutlineSection[] = [];
  for (const el of prose.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote')) {
    if (el.parentElement?.closest('li, blockquote, p, pre, figure, table')) continue;
    if (!el.textContent?.trim()) continue;
    sections.push({ el, heading: /^H[1-6]$/.test(el.tagName) });
  }
  return sections;
}

function firstSentence(text: string): string {
  const match = text.match(/^.{12,}?[.!?](?=\s|$)/);
  return (match?.[0] ?? text).slice(0, 90);
}

function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Neighbours join a group, a heading starts one, and each group holds at most `size` blocks. */
function groupBySize(sections: OutlineSection[], size: number): OutlineSection[][] {
  const result: OutlineSection[][] = [];
  for (const section of sections) {
    const last = result.at(-1);
    if (last && !section.heading && last.length < size) last.push(section);
    else result.push([section]);
  }
  return result;
}

/** Fold neighbouring groups together, evenly, until `max` remain. */
function mergeEvenly(groups: OutlineSection[][], max: number): OutlineSection[][] {
  const per = Math.ceil(groups.length / max);
  const merged: OutlineSection[][] = [];
  for (let at = 0; at < groups.length; at += per) merged.push(groups.slice(at, at + per).flat());
  return merged;
}

function describe(chunks: OutlineSection[][], all: OutlineSection[]): OutlineGroup[] {
  return chunks.map((sections, id) => {
    const heading = sections.find((section) => section.heading);
    const lead = heading ?? sections[0];
    const text = plain(lead?.el.textContent);
    const title = heading ? text.slice(0, 90) : firstSentence(text);
    const next = lead ? all[all.indexOf(lead) + 1] : undefined;
    const body = heading ? plain(next?.el.textContent) : text.slice(title.length).trim();
    return { id, sections, heading, title, body };
  });
}

/**
 * Group the blocks into at most `max` ticks. Blocks merge in growing runs, a heading always
 * starts a group, and when headings alone are too many the groups merge evenly.
 */
export function groupSections(sections: OutlineSection[], max = MAX_TICKS): OutlineGroup[] {
  let chunks = groupBySize(sections, 1);
  for (let size = 2; chunks.length > max && size <= sections.length; size += 1)
    chunks = groupBySize(sections, size);
  if (chunks.length > max) chunks = mergeEvenly(chunks, max);
  return describe(chunks, sections);
}
