import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../api/hooks';
import { makeLink, twitterSourceData } from '../../test/fixtures';
import { LinkMenuActions } from '../RowMenu';
import { RowMenuProvider } from '../RowMenuContext';
import { ReaderContent } from './ReaderContent';

function renderPost(postedAt?: string) {
  const link = makeLink({
    url: 'https://x.com/amitray007/status/1',
    sourceData: { ...twitterSourceData, ...(postedAt && { postedAt }) },
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReaderContent link={link} />
    </QueryClientProvider>,
  );
}

describe('TweetCard', () => {
  it('shows when the post went out', () => {
    const { container } = renderPost('Sat Oct 10 06:36:53 +0000 2026');
    const time = container.querySelector('time.silo-reader-posted');
    expect(time?.getAttribute('dateTime')).toBe('2026-10-10T06:36:53.000Z');
    expect(time?.textContent).toMatch(/2026/);
  });

  it('starts each post video fresh when the open post changes', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    const client = new QueryClient();
    const post = (id: string) =>
      makeLink({
        id,
        url: 'https://x.com/amitray007/status/1',
        sourceData: {
          ...twitterSourceData,
          mediaUrls: ['https://video.twimg.com/amplify_video/1/vid/clip.mp4'],
        },
      });
    const tree = (id: string) => (
      <QueryClientProvider client={client}>
        <ReaderContent link={post(id)} />
      </QueryClientProvider>
    );
    const view = render(tree('first'));
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    view.rerender(tree('second'));
    expect(screen.getByRole('button', { name: 'Play video' })).toBeDefined();
    vi.restoreAllMocks();
  });

  it("shows the author's picture through silo's proxy, never X directly", () => {
    const link = makeLink({
      url: 'https://x.com/amitray007/status/1',
      sourceData: {
        ...twitterSourceData,
        authorAvatarUrl: 'https://pbs.twimg.com/profile_images/1/face_200x200.jpg',
      },
    });
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ReaderContent link={link} />
      </QueryClientProvider>,
    );
    const avatar = container.querySelector('img.silo-reader-avatar');
    expect(avatar?.getAttribute('src')).toBe(`/api/links/${link.id}/source-media/avatar`);
    expect(renderPost().container.querySelector('img.silo-reader-avatar')).toBeNull();
  });

  it('leaves the line out when the date is missing or unreadable', () => {
    expect(renderPost().container.querySelector('time')).toBeNull();
    expect(renderPost('soon').container.querySelector('time')).toBeNull();
  });
});

describe('Live Reader', () => {
  const reader = {
    contentHtml: '<h2>Live heading</h2><p>Live body</p><img src="https://cdn.test/a.png">',
    contentImages: ['https://cdn.test/a.png'],
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const stored = makeLink({ extractedText: 'Stored first.\n\nStored second.' });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function show(
    respond: () => Response | Promise<Response>,
    link = stored,
    props: { trashed?: boolean; topPlayerSrc?: string } = {},
  ) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => respond());
    vi.stubGlobal('fetch', fetchMock);
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <ReaderContent link={link} {...props} />
      </QueryClientProvider>,
    );
    return { ...view, fetchMock };
  }

  it.each([false, true])(
    'keeps the prose player unless a top player is rendered: %s',
    async (top) => {
      const src = 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?enablejsapi=1';
      const { container } = show(
        () =>
          json({
            contentHtml:
              '<p>Video body</p><figure data-silo-embed><a href="https://www.youtube.com/embed/jNQXAC9IVRw">www.youtube.com</a></figure>',
            contentImages: [],
          }),
        makeLink({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }),
        top ? { topPlayerSrc: src } : {},
      );
      await screen.findByText('Video body');
      expect(container.querySelectorAll('iframe')).toHaveLength(top ? 0 : 1);
    },
  );

  it('shows no saved-time line for a stored Reader', async () => {
    const capturedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    show(() => json({ ...reader, capturedAt }));
    await screen.findByText('Live body');
    expect(screen.queryByText(/Saved /)).toBeNull();
  });

  it('shows the skeleton while loading, then the live prose with proxied images', async () => {
    const { container, fetchMock } = show(() => json(reader));
    expect(screen.getByRole('status', { name: 'Loading article' })).toBeDefined();
    expect(screen.queryByText('Stored first.')).toBeNull();
    await screen.findByText('Live body');
    expect(screen.queryByRole('status', { name: 'Loading article' })).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/links/${stored.id}/reader`);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      `/api/links/${stored.id}/content-image/0`,
    );
    expect(screen.queryByText('Stored first.')).toBeNull();
  });

  it.each([
    ['404', () => json({ error: 'not_found', message: 'No Reader content' }, 404)],
    ['500', () => json({ error: 'internal_error', message: 'Boom' }, 500)],
    ['network failure', () => Promise.reject(new TypeError('offline'))],
  ])('falls back to the stored text on %s', async (_name, respond) => {
    const { container } = show(respond);
    await screen.findByText('Stored first.');
    expect(screen.getByText('Stored second.')).toBeDefined();
    expect(container.querySelector('.silo-reader-prose')).toBeNull();
  });

  it('shows the no-text state when the Reader is missing and nothing is stored', async () => {
    show(
      () => json({ error: 'not_found', message: 'No Reader content' }, 404),
      makeLink({ extractedText: null, description: null }),
    );
    expect(screen.queryByText('No text to read')).toBeNull();
    await screen.findByText('No text to read');
  });

  it('does not show the no-text state when the live Reader has content', async () => {
    show(() => json(reader), makeLink({ extractedText: null, description: null }));
    await screen.findByText('Live body');
    expect(screen.queryByText('No text to read')).toBeNull();
  });

  it('does not ask for a Reader for an X post or a trashed link', async () => {
    const post = makeLink({
      url: 'https://x.com/amitray007/status/1',
      sourceData: twitterSourceData,
    });
    const first = show(() => json(reader), post);
    first.unmount();
    const second = show(() => json(reader), stored, { trashed: true });
    expect(second.fetchMock).not.toHaveBeenCalled();
    expect(first.fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Stored first.')).toBeDefined());
  });

  it('shows only the capturing skeleton while the link is still enriching', () => {
    const { fetchMock } = show(() => json(reader), makeLink({ captureStatus: 'enriching' }));
    expect(screen.getByRole('status', { name: 'Capturing page' })).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Reader refresh', () => {
  const oldReader = {
    contentHtml: '<p>Previous article</p><img src="https://cdn.test/old.png">',
    contentImages: ['https://cdn.test/old.png'],
    capturedAt: '2026-10-27T12:00:00.000Z',
  };
  afterEach(() => vi.unstubAllGlobals());

  function show(refreshId = 'open') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.liveReader('open'), oldReader);
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/reader/refresh')) return pending;
        return new Response(JSON.stringify({ tags: [] }), { status: 200 });
      }),
    );
    const view = render(
      <QueryClientProvider client={client}>
        <RowMenuProvider>
          <LinkMenuActions link={makeLink({ id: refreshId })} onClose={() => {}} />
          <div className="silo-reader-scroll">
            <ReaderContent link={makeLink({ id: 'open' })} />
          </div>
        </RowMenuProvider>
      </QueryClientProvider>,
    );
    const scroll = view.container.querySelector<HTMLElement>('.silo-reader-scroll');
    if (!scroll) throw new Error('missing scroller');
    scroll.scrollTop = 400;
    return { ...view, client, scroll, finish };
  }

  it('shows the shared skeleton and rebuilds the open article after success, at the top', async () => {
    const { container, finish, scroll } = show();
    const old = screen.getByText('Previous article');
    old.setAttribute('data-old-dom', 'true');
    const oldImage = container.querySelector('img');
    if (!oldImage) throw new Error('missing article image');
    fireEvent.error(oldImage);
    expect(oldImage.dataset.loaded).toBe('true');
    fireEvent.click(screen.getByText('Refresh reader'));
    await screen.findByRole('status', { name: 'Refreshing reader' });
    expect(screen.queryByText('Previous article')).toBeNull();
    expect(scroll.scrollTop).toBe(400);
    await act(async () =>
      finish(
        new Response(
          JSON.stringify({
            contentHtml: '<p>Replacement article</p><img src="https://cdn.test/new.png">',
            contentImages: ['https://cdn.test/new.png'],
            capturedAt: '2026-10-28T12:00:00.000Z',
          }),
          { status: 200 },
        ),
      ),
    );
    await screen.findByText('Replacement article');
    expect(screen.queryByText('Previous article')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Refreshing reader' })).toBeNull();
    expect(container.querySelector('[data-old-dom]')).toBeNull();
    expect(container.querySelector('img')).not.toBe(oldImage);
    expect(container.querySelector('img')?.dataset.loaded).toBe('false');
    expect(scroll.scrollTop).toBe(0);
  });

  it('keeps the open article visible when another link refreshes', async () => {
    const { finish, scroll } = show('other');
    const old = screen.getByText('Previous article');
    fireEvent.click(screen.getByText('Refresh reader'));
    await screen.findByText('Refreshing…');
    expect(screen.queryByRole('status', { name: 'Refreshing reader' })).toBeNull();
    expect(screen.getByText('Previous article')).toBe(old);
    await act(async () =>
      finish(
        new Response(
          JSON.stringify({
            ...oldReader,
            contentHtml: '<p>Other article</p>',
            capturedAt: '2026-10-28T12:00:00.000Z',
          }),
          { status: 200 },
        ),
      ),
    );
    await screen.findByText('Refresh reader');
    expect(screen.getByText('Previous article')).toBe(old);
    expect(screen.queryByText('Other article')).toBeNull();
    expect(scroll.scrollTop).toBe(400);
  });

  it.each([422, 502, 503])(
    'restores the previous Reader and shows the existing error on %s',
    async (status) => {
      const { client, finish, scroll } = show();
      fireEvent.click(screen.getByText('Refresh reader'));
      await screen.findByRole('status', { name: 'Refreshing reader' });
      await act(async () =>
        finish(
          new Response(
            JSON.stringify({
              error: 'fetch_failed',
              message: 'Reader refresh failed',
            }),
            { status },
          ),
        ),
      );
      await screen.findByText('Previous article');
      expect(screen.getByRole('alert').textContent).toBe('Reader refresh failed');
      expect(screen.queryByRole('status', { name: 'Refreshing reader' })).toBeNull();
      expect(client.getQueryData(queryKeys.liveReader('open'))).toEqual(oldReader);
      expect(scroll.scrollTop).toBe(400);
    },
  );
});
