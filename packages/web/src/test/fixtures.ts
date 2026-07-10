import type { LinkJson, SourceData, TrashLinkJson } from '../api/types';

/**
 * A minimal, valid `LinkJson` fixture for tests — every field defaulted so
 * call sites only spell out what the test actually varies. Shared across
 * `LinkRow`/`DayGroup`/`LibraryView` tests (plan 010) so the row shape isn't
 * duplicated three times as new fields are added to `LinkJson`.
 */
export function makeLink(overrides: Partial<LinkJson> = {}): LinkJson {
  return {
    id: '1',
    url: 'https://example.com',
    title: 'Example',
    description: null,
    imageUrl: null,
    siteName: null,
    extractedText: null,
    sourceKind: 'link',
    sourceData: { kind: 'link' },
    captureStatus: 'full',
    addedBy: 'user',
    source: 'unknown',
    notes: null,
    tags: [],
    createdAt: '2026-07-05T12:00:00.000Z',
    updatedAt: '2026-07-05T12:00:00.000Z',
    ...overrides,
  };
}

/** A minimal, valid `TrashLinkJson` fixture (`makeLink` plus `deletedAt`) — shared by `TrashRow`/`TrashView`/trash-hook tests (plan 011, V3-5). */
export function makeTrashLink(overrides: Partial<TrashLinkJson> = {}): TrashLinkJson {
  return {
    ...makeLink(overrides),
    deletedAt: '2026-07-05T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * Per-variant `sourceData` fixtures (plan 012 phase 2 — rich hover previews)
 * for `HoverPreview`/`LinkRow` tests. Each pairs with `makeLink({ sourceData:
 * ... })` to build a fixture link of that source kind.
 */
export const hackerNewsSourceData: Extract<SourceData, { kind: 'hacker_news' }> = {
  kind: 'hacker_news',
  points: 342,
  comments: 128,
  author: 'pg',
};

export const githubSourceData: Extract<SourceData, { kind: 'github' }> = {
  kind: 'github',
  stars: 58100,
  forks: 6600,
  issues: 412,
  description: 'Reference implementations for the Model Context Protocol',
  language: 'TypeScript',
  languagePct: 72,
};

export const youtubeSourceData: Extract<SourceData, { kind: 'youtube' }> = {
  kind: 'youtube',
  channel: 'Fireship',
  thumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
};

export const twitterSourceData: Extract<SourceData, { kind: 'twitter' }> = {
  kind: 'twitter',
  text: 'Just shipped a new feature — thrilled with how it turned out.',
  authorHandle: 'amitray007',
  authorName: 'Amit Ray',
  likes: 512,
  reposts: 48,
  replies: 23,
  quotes: 6,
  bookmarks: 91,
};
