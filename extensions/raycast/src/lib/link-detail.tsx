import { List } from '@raycast/api';
import { statusLabel } from './detail-markdown.js';
import { faviconUrl, domainOf as hostOf, previewImageUrl } from './image-urls.js';
import type { CapturedLink } from './types.js';

/** One labeled stat row in the detail pane's source-specific stat block. */
type DetailStat = { label: string; value: string };

/** The pure model `LinkDetail` renders — extracted so it's unit-testable without a Raycast render (see plan Task 6: `@raycast/api` is types-only under vitest). */
export type LinkDetailModel = {
  title: string;
  faviconUrl: string;
  /** Only set when the source can plausibly have an image (youtube / twitter media / a captured `imageUrl`) — never guessed, never a broken-image placeholder. */
  imageUrl: string | null;
  imageCaption: string | null;
  stats: DetailStat[];
  description: string | null;
};

/** Builds the source-specific stat rows (GitHub/HN/Twitter/YouTube/plain link — per the design spec's "Detail rendering" table). */
function statsFor(link: CapturedLink): DetailStat[] {
  const data = link.sourceData;
  switch (data.kind) {
    case 'github': {
      const stats: DetailStat[] = [
        { label: 'Stars', value: String(data.stars) },
        { label: 'Forks', value: String(data.forks) },
        { label: 'Issues', value: String(data.issues) },
      ];
      if (data.language) stats.push({ label: 'Language', value: data.language });
      return stats;
    }
    case 'hacker_news':
      return [
        { label: 'Points', value: String(data.points) },
        { label: 'Comments', value: String(data.comments) },
        { label: 'Author', value: data.author },
      ];
    case 'twitter':
      return [
        { label: 'Author', value: `${data.authorName} (@${data.authorHandle})` },
        { label: 'Likes', value: String(data.likes) },
        { label: 'Reposts', value: String(data.reposts) },
        { label: 'Replies', value: String(data.replies) },
      ];
    case 'youtube':
      return [{ label: 'Channel', value: data.channel }];
    default:
      return [];
  }
}

/**
 * Decides the detail pane's image + stats + favicon for a link — the ONE
 * place that decides "does this link get an image row" (youtube / twitter
 * media / a captured `imageUrl`), and the ONE place per-link image URLs are
 * built, always through `image-urls.ts`'s proxy helpers (privacy binding —
 * never the source host).
 */
export function detailModel(link: CapturedLink, baseUrl: string): LinkDetailModel {
  const title = link.title?.trim() || hostOf(link.url) || link.url;
  const data = link.sourceData;

  let imageUrl: string | null = null;
  let imageCaption: string | null = null;
  if (data.kind === 'youtube') {
    imageUrl = previewImageUrl(baseUrl, link.id);
    imageCaption = `▶ ${data.channel} · YouTube`;
  } else if (data.kind === 'twitter') {
    imageUrl = previewImageUrl(baseUrl, link.id);
    imageCaption = `@${data.authorHandle} · X`;
  } else if (link.imageUrl) {
    imageUrl = previewImageUrl(baseUrl, link.id);
    imageCaption = link.siteName ?? hostOf(link.url) ?? null;
  }

  return {
    title,
    faviconUrl: faviconUrl(baseUrl, hostOf(link.url)),
    imageUrl,
    imageCaption,
    stats: statsFor(link),
    description: link.description,
  };
}

function buildMarkdown(model: LinkDetailModel): string {
  const parts: string[] = [
    `![](${model.faviconUrl}?raycast-width=16&raycast-height=16) ${model.title}`,
  ];
  if (model.imageUrl) {
    parts.push(`![](${model.imageUrl})`);
    if (model.imageCaption) parts.push(model.imageCaption);
  }
  if (model.description) parts.push(model.description);
  return parts.join('\n\n');
}

/**
 * The shared detail pane for Search + Browse (design spec: "Search + Browse
 * share one component"). Favicon-before-title, an image when the source
 * plausibly has one, source-specific stats, and the Source/Status/Saved/
 * Tags metadata table.
 */
export function LinkDetail({ link, baseUrl }: { link: CapturedLink; baseUrl: string }) {
  const model = detailModel(link, baseUrl);

  return (
    <List.Item.Detail
      markdown={buildMarkdown(model)}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label
            title="Source"
            text={link.siteName ?? hostOf(link.url)}
          />
          <List.Item.Detail.Metadata.Label title="Status" text={statusLabel(link.captureStatus)} />
          <List.Item.Detail.Metadata.Label
            title="Saved"
            text={new Date(link.createdAt).toLocaleString()}
          />
          {model.stats.map((stat) => (
            <List.Item.Detail.Metadata.Label
              key={stat.label}
              title={stat.label}
              text={stat.value}
            />
          ))}
          {link.tags.length > 0 && (
            <List.Item.Detail.Metadata.TagList title="Tags">
              {link.tags.map((tag) => (
                <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </List.Item.Detail.Metadata.TagList>
          )}
        </List.Item.Detail.Metadata>
      }
    />
  );
}
