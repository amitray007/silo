import { Icon, type Image } from '@raycast/api';
import { faviconUrl } from './image-urls.js';
import type { CapturedLink } from './types.js';

/** Maps a link's `sourceKind` to a Raycast icon for the results list — mirrors the reference UI's per-row source-typed icon (GitHub mark, link glyph, document glyph). Known source plugins keep their enum glyph; a plain link instead leads with the site favicon via silo's proxy, falling back to the link glyph if the favicon fails to load (Raycast's `{ source, fallback }` `Image.ImageLike` handles the fallback for free). */
export function sourceIcon(link: CapturedLink, baseUrl: string): Image.ImageLike {
  switch (link.sourceKind) {
    case 'twitter':
      return Icon.Bird;
    case 'hacker_news':
      return Icon.Terminal;
    default:
      if (link.sourceData.kind === 'github') return Icon.Code;
      if (link.sourceData.kind === 'youtube') return Icon.Play;
      return { source: faviconUrl(baseUrl, domainOf(link.url)), fallback: Icon.Link };
  }
}

/** The domain suffix shown next to a row's title (reference UI's `title` row + implicit domain), derived from the link's URL — falls back to the raw URL if parsing fails (should not happen for a stored link, since the API rejects unparseable URLs at capture time). */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
