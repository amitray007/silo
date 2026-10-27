import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLink, twitterSourceData } from '../../test/fixtures';
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
    props: { trashed?: boolean } = {},
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
