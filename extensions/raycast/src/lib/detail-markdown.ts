import { domainOf } from './source-icon.js';
import type { CapturedLink } from './types.js';

/**
 * Builds the detail pane's markdown — modeled on
 * `docs/plans/refs/raycast-search-detail-reference.png`: a rich card up top
 * (repo/post name, description, a stat row) followed by the Information
 * table (Source/Type/URL/Title/saved-at). Raycast's `Detail` component
 * renders GFM-ish markdown, so the "card" is built as a markdown heading +
 * table rather than custom React — matching the reference's shape within
 * Raycast's actual rendering surface (no custom card layout API exists).
 */
export function buildDetailMarkdown(link: CapturedLink): string {
  const title = link.title?.trim() || domainOf(link.url);
  const parts: string[] = [`# ${escapeMd(title)}`];

  if (link.description) {
    parts.push(escapeMd(link.description));
  }

  const statRow = buildStatRow(link);
  if (statRow) parts.push(statRow);

  if (link.sourceData.kind === 'twitter') {
    parts.push(`> ${escapeMd(link.sourceData.text)}`);
  }

  return parts.join('\n\n');
}

function buildStatRow(link: CapturedLink): string | undefined {
  const data = link.sourceData;
  if (data.kind === 'github') {
    const cells = [
      `⭐ **${data.stars}** Stars`,
      `🍴 **${data.forks}** Forks`,
      `⚠️ **${data.issues}** Issues`,
    ];
    if (data.language) cells.push(`💻 ${escapeMd(data.language)}`);
    return cells.join('&nbsp;&nbsp;&nbsp;');
  }
  if (data.kind === 'hacker_news') {
    return `▲ **${data.points}** points&nbsp;&nbsp;&nbsp;💬 **${data.comments}** comments&nbsp;&nbsp;&nbsp;by ${escapeMd(data.author)}`;
  }
  if (data.kind === 'twitter') {
    return `❤️ **${data.likes}**&nbsp;&nbsp;&nbsp;🔁 **${data.reposts}**&nbsp;&nbsp;&nbsp;💬 **${data.replies}**&nbsp;&nbsp;&nbsp;@${escapeMd(data.authorHandle)}`;
  }
  return undefined;
}

function escapeMd(value: string): string {
  return value.replace(/([\\_*`[\]])/g, '\\$1');
}

/** Human-readable capture status, for the Information table. */
export function statusLabel(status: CapturedLink['captureStatus']): string {
  switch (status) {
    case 'enriching':
      return '◌ Enriching';
    case 'full':
      return 'Full';
    case 'partial':
      return 'Partial';
    case 'bare':
      return 'Bare';
  }
}
