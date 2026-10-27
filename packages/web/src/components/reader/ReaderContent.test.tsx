import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('leaves the line out when the date is missing or unreadable', () => {
    expect(renderPost().container.querySelector('time')).toBeNull();
    expect(renderPost('soon').container.querySelector('time')).toBeNull();
  });
});
