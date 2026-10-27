import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TweetMedia } from './TweetMedia';

const media = [
  'https://pbs.twimg.com/media/one.jpg',
  'https://video.twimg.com/amplify_video/1/vid/clip.mp4',
  'https://video.twimg.com/tweet_video/loop.mp4',
  'https://evil.test/skip.jpg',
  'https://pbs.twimg.com/media/two.jpg',
];

describe('TweetMedia', () => {
  it('serves every item through silo and lays out at most four', () => {
    const { container } = render(<TweetMedia linkId="post" mediaUrls={media} hasPoster />);
    const grid = container.querySelector('.silo-tweet-media');
    expect(grid?.getAttribute('data-count')).toBe('4');
    const sources = [...container.querySelectorAll('img, video')].map((node) =>
      node.getAttribute('src'),
    );
    expect(sources).toEqual([
      '/api/links/post/source-media/0',
      '/api/links/post/source-media/1',
      '/api/links/post/source-media/2',
      '/api/links/post/source-media/4',
    ]);
    expect(container.innerHTML).not.toContain('twimg.com');
  });

  it('plays videos on demand and loops GIFs silently', () => {
    const { container } = render(
      <TweetMedia linkId="post" mediaUrls={[media[1] as string, media[2] as string]} hasPoster />,
    );
    const [video, gif] = [...container.querySelectorAll('video')];
    expect(video?.getAttribute('poster')).toBe('/api/links/post/source-media/poster');
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.closest('figure')?.getAttribute('aria-label')).toBe('Video from the post');
    expect(screen.getByRole('button', { name: 'Play video' })).toBeDefined();
    expect(gif?.hasAttribute('controls')).toBe(false);
    expect(gif?.hasAttribute('loop')).toBe(true);
    expect((gif as HTMLVideoElement).muted).toBe(true);
    // GIFs keep a way to stop them (WCAG 2.2.2).
    expect(gif?.closest('button')?.getAttribute('aria-label')).toMatch(/GIF$/);
  });

  it('opens photos in the image viewer', () => {
    render(<TweetMedia linkId="post" mediaUrls={media} hasPoster={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'View image 2 of 2' }));
    expect(screen.getByRole('dialog').querySelector('.silo-viewer-count')?.textContent).toBe(
      '2 / 2',
    );
  });

  it('names a thread post in every proxy path, including the video still', () => {
    const { container } = render(
      <TweetMedia
        linkId="post"
        mediaUrls={[media[1] as string, media[0] as string]}
        hasPoster
        scope="after-2"
      />,
    );
    const sources = [...container.querySelectorAll('img, video')].map((node) => [
      node.getAttribute('src'),
      node.getAttribute('poster'),
    ]);
    expect(sources).toEqual([
      ['/api/links/post/source-media/after-2-0', '/api/links/post/source-media/after-2-poster'],
      ['/api/links/post/source-media/after-2-1', null],
    ]);
  });

  it('renders nothing when no item is on X media hosts', () => {
    const { container } = render(
      <TweetMedia linkId="post" mediaUrls={['https://evil.test/a.jpg']} hasPoster={false} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
