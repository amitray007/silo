import { afterEach, describe, expect, it, vi } from 'vitest';
import { getById } from './links.js';
import { PageViewerUnavailableError, setPageViewer, viewPage } from './view.js';

vi.mock('./links.js', () => ({ getById: vi.fn() }));
afterEach(() => {
  setPageViewer(undefined);
  vi.resetAllMocks();
});

describe('PageViewer port', () => {
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
    });
  });
});
