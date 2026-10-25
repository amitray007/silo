import { getById } from './links.js';

export type FrameHint = {
  mode: 'direct' | 'view' | 'none';
  reason?: string;
  contentType?: string;
};

export type PageView = { frame: FrameHint; html?: string };

/** Process-local port. Only the composition root registers the worker implementation. */
export type PageViewer = (input: {
  id: string;
  url: string;
  origin: string;
  signal: AbortSignal;
}) => Promise<PageView>;

export class PageViewerUnavailableError extends Error {
  constructor() {
    super('Page viewer unavailable');
    this.name = 'PageViewerUnavailableError';
  }
}

let viewer: PageViewer | undefined;

export function setPageViewer(next: PageViewer | undefined): void {
  viewer = next;
}

/** Resolve the live, stored URL on every read, including cache hits. */
export async function viewPage(
  id: string,
  origin: string,
  signal: AbortSignal,
): Promise<PageView | null> {
  const link = await getById(id);
  if (!link) return null;
  if (!viewer) throw new PageViewerUnavailableError();
  return viewer({ id, url: link.url, origin, signal });
}
