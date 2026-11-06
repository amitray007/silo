import { afterEach, describe, expect, it, vi } from 'vitest';
import { getById } from './links.js';
import { PageViewerUnavailableError, setPageViewer, viewPage } from './view.js';

vi.mock('./links.js', () => ({ getById: vi.fn() }));
afterEach(() => {
  setPageViewer(undefined);
  vi.resetAllMocks();
});

describe('PageViewer port', () => {
  it('passes a snapshot only for an archive Reader', async () => {
    const date = new Date('2026-10-16T01:02:03Z');
    const viewer = vi.fn(async (_input: Parameters<import('./view.js').PageViewer>[0]) => ({
      frame: { mode: 'none' as const },
    }));
    setPageViewer(viewer);
    for (const readerSource of ['archive', 'extension'] as const) {
      vi.mocked(getById).mockResolvedValue({
        url: 'https://stored.test',
        readerSource,
        readerSourceAt: date,
      } as Awaited<ReturnType<typeof getById>>);
      await viewPage('id', 'https://silo.test', new AbortController().signal);
      const input = viewer.mock.calls.at(-1);
      expect(input).toBeDefined();
      expect(viewer).toHaveBeenLastCalledWith(
        expect.objectContaining(
          readerSource === 'archive' ? { archiveSnapshotAt: date } : { url: 'https://stored.test' },
        ),
      );
      if (readerSource !== 'archive') expect(input?.[0]).not.toHaveProperty('archiveSnapshotAt');
    }
  });
  it('fails closed without a registered viewer', async () => {
    vi.mocked(getById).mockResolvedValue({ url: 'https://stored.test' } as Awaited<
      ReturnType<typeof getById>
    >);
    await expect(
      viewPage('id', 'https://silo.test', new AbortController().signal),
    ).rejects.toBeInstanceOf(PageViewerUnavailableError);
  });
  it('never calls a viewer for a missing or trashed link', async () => {
    const viewer = vi.fn();
    setPageViewer(viewer);
    vi.mocked(getById).mockResolvedValue(null);
    expect(await viewPage('missing', 'https://silo.test', new AbortController().signal)).toBeNull();
    expect(viewer).not.toHaveBeenCalled();
  });
  it('passes only the stored URL and current request origin/signal', async () => {
    vi.mocked(getById).mockResolvedValue({ url: 'https://stored.test' } as Awaited<
      ReturnType<typeof getById>
    >);
    const viewer = vi.fn(async () => ({ frame: { mode: 'view' as const }, html: '<p>Safe</p>' }));
    setPageViewer(viewer);
    const signal = new AbortController().signal;
    expect(await viewPage('id', 'https://silo.test:5175', signal)).toEqual({
      frame: { mode: 'view' },
      html: '<p>Safe</p>',
    });
    expect(viewer).toHaveBeenCalledWith({
      id: 'id',
      url: 'https://stored.test',
      origin: 'https://silo.test:5175',
      signal,
      fresh: false,
    });
  });
});
