import type { LinkJson, TrashLinkJson } from '../api/types';

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
    captureStatus: 'full',
    addedBy: 'user',
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
