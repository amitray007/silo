import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { twitterSourceData } from '../../test/fixtures';
import { TweetCard, type TweetSource } from './TweetCard';

function card(extra: Partial<TweetSource> = {}) {
  return render(<TweetCard linkId="post" source={{ ...twitterSourceData, ...extra }} />);
}

const avatar = 'https://pbs.twimg.com/profile_images/1/face_200x200.jpg';
const posted = 'Fri Oct 23 18:24:09 +0000 2026';

describe('TweetCard text', () => {
  it('turns URLs, handles and hashtags into safe links and keeps line breaks', () => {
    const { container } = card({
      text: 'New post (https://aiengg.dev/blog/x). Thanks @ClaudeAI #agents\nsecond line',
    });
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual([
      'https://aiengg.dev/blog/x',
      '@ClaudeAI',
      '#agents',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://aiengg.dev/blog/x',
      'https://x.com/ClaudeAI',
      'https://x.com/hashtag/agents',
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(container.querySelector('p')?.textContent).toBe(
      'New post (https://aiengg.dev/blog/x). Thanks @ClaudeAI #agents\nsecond line',
    );
  });

  it('never makes a javascript: link', () => {
    const { container } = card({ text: 'javascript:alert(1) and <b>not html</b>' });
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe(
      'javascript:alert(1) and <b>not html</b>',
    );
  });
});

describe('TweetCard single post', () => {
  it('has no thread label, list or saved marker and shows name, time and stats', () => {
    const { container, queryByText } = card({ authorAvatarUrl: avatar, postedAt: posted });
    expect(container.querySelector('ol, .silo-thread-post')).toBeNull();
    expect(queryByText(/^Thread/)).toBeNull();
    expect(queryByText('Saved post')).toBeNull();
    expect(container.querySelector('.silo-reader-who')?.textContent).toBe('Amit Ray @amitray007');
    expect(container.querySelector('.silo-reader-who img.silo-reader-avatar')).not.toBeNull();
    expect(container.querySelectorAll('time.silo-reader-posted')).toHaveLength(1);
    const stats = [...container.querySelectorAll('.silo-post-stat')].map((item) =>
      item.getAttribute('title'),
    );
    expect(stats).toEqual([
      '23 replies',
      '48 reposts',
      '512 likes',
      expect.stringMatching(/bookmark/),
    ]);
  });

  it('writes X-style short counts and leaves zero blank', () => {
    const { container } = card({ likes: 2189, reposts: 0, replies: 1, bookmarks: 15_600 });
    const shown = [...container.querySelectorAll('.silo-post-stat > span[aria-hidden]')].map(
      (item) => item.textContent,
    );
    expect(shown).toEqual(['1', '', '2.1K', '15.6K']);
    expect(container.querySelector('.silo-post-stat[title="1 reply"]')).not.toBeNull();
    expect(
      container.querySelector('.silo-post-stat[title="2,189 likes"] .silo-sr-only')?.textContent,
    ).toBe('2,189 likes');
  });

  it('treats empty thread arrays as no thread', () => {
    const { container } = card({ threadBefore: [], threadAfter: [] });
    expect(container.querySelector('.silo-reader-thread')).toBeNull();
  });
});

describe('TweetCard thread', () => {
  const before = [
    { id: '1', text: 'First of the thread', postedAt: 'Fri Oct 23 18:24:08 +0000 2026' },
  ];
  const after = [
    {
      id: '3',
      text: 'Third, see https://example.com/more',
      postedAt: 'Fri Oct 23 18:24:10 +0000 2026',
      mediaUrls: [
        'https://pbs.twimg.com/media/p.jpg',
        'https://video.twimg.com/amplify_video/9/v.mp4',
      ],
      thumbnailUrl: 'https://pbs.twimg.com/amplify_video_thumb/9/img/v.jpg',
    },
    { id: '4', text: '' },
  ];

  it('shows every post as a row with a header line, and the name only once', () => {
    const { container, getByText } = card({
      authorAvatarUrl: avatar,
      postedAt: posted,
      threadBefore: before,
      threadAfter: after,
    });
    expect(getByText('Thread · 4 posts')).toBeDefined();
    const rows = [...container.querySelectorAll('li.silo-thread-post')];
    expect(rows).toHaveLength(4);
    expect(container.querySelectorAll('.silo-reader-who')).toHaveLength(1);
    expect(rows[0]?.querySelector('.silo-reader-who')?.textContent).toBe('Amit Ray @amitray007');
    expect(rows.map((row) => row.querySelector('p')?.textContent ?? null)).toEqual([
      'First of the thread',
      twitterSourceData.text,
      'Third, see https://example.com/more',
      null,
    ]);
    // Each row has the author's picture, served by silo.
    const pictures = [...container.querySelectorAll('img.silo-reader-avatar')];
    expect(pictures).toHaveLength(4);
    expect(new Set(pictures.map((img) => img.getAttribute('src')))).toEqual(
      new Set(['/api/links/post/source-media/avatar']),
    );
    // The connector runs between rows, never after the last one.
    expect(container.querySelectorAll('.silo-thread-line')).toHaveLength(3);
    expect(rows[3]?.querySelector('.silo-thread-line')).toBeNull();
  });

  it('marks the saved post when it is not first, and keeps stats and full time on it alone', () => {
    const { container, getAllByText } = card({
      postedAt: posted,
      threadBefore: before,
      threadAfter: after,
    });
    expect(getAllByText('Saved post')).toHaveLength(1);
    const saved = container.querySelector('li[data-saved]');
    expect(saved?.querySelector('.silo-thread-saved')?.textContent).toBe('Saved post');
    expect(saved?.querySelector('p')?.textContent).toBe(twitterSourceData.text);
    // The other three posts read a little quieter.
    expect(container.querySelectorAll('li[data-dim]')).toHaveLength(3);
    expect(saved?.hasAttribute('data-dim')).toBe(false);
    expect(container.querySelectorAll('.silo-reader-stats')).toHaveLength(1);
    expect(saved?.querySelector('.silo-reader-stats')).not.toBeNull();
    // Saved post and the two dated thread posts each get a time line.
    expect(container.querySelectorAll('time.silo-reader-posted')).toHaveLength(3);
  });

  it('does not mark the saved post when it opens the thread', () => {
    const { container, queryByText } = card({ threadAfter: after });
    expect(queryByText('Saved post')).toBeNull();
    expect(container.querySelector('li[data-dim]')).toBeNull();
    expect(container.querySelector('li')?.hasAttribute('data-saved')).toBe(true);
    expect(container.querySelector('li .silo-reader-who')).not.toBeNull();
    expect(queryByText('Thread · 3 posts')).not.toBeNull();
  });

  it('keeps a spacer in the avatar rail when the author has no picture', () => {
    const { container } = card({ threadAfter: after });
    expect(container.querySelectorAll('img.silo-reader-avatar')).toHaveLength(0);
    expect(
      container.querySelectorAll('li > .silo-thread-rail > span.silo-reader-avatar'),
    ).toHaveLength(3);
  });

  it('linkifies thread post text too', () => {
    const { container } = card({ threadAfter: after });
    const hrefs = [...container.querySelectorAll('li a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/more']);
  });

  it('serves thread media through the post-specific proxy targets', () => {
    const { container } = card({
      mediaUrls: ['https://pbs.twimg.com/media/saved.jpg'],
      threadBefore: [{ id: '1', text: 'a', mediaUrls: ['https://pbs.twimg.com/media/b.jpg'] }],
      threadAfter: after,
    });
    const sources = [...container.querySelectorAll('img:not(.silo-reader-avatar), video')].map(
      (node) => ({
        src: node.getAttribute('src'),
        poster: node.getAttribute('poster'),
      }),
    );
    expect(sources).toEqual([
      { src: '/api/links/post/source-media/before-0-0', poster: null },
      { src: '/api/links/post/source-media/0', poster: null },
      { src: '/api/links/post/source-media/after-0-0', poster: null },
      { src: '/api/links/post/source-media/after-0-1', poster: null },
    ]);
    expect(container.innerHTML).not.toContain('twimg.com');
  });

  it('uses the thread post video still as that video poster', () => {
    const { container } = card({
      threadAfter: [
        {
          id: '3',
          text: 'clip',
          mediaUrls: ['https://video.twimg.com/amplify_video/9/v.mp4'],
          thumbnailUrl: 'https://pbs.twimg.com/amplify_video_thumb/9/img/v.jpg',
        },
      ],
    });
    expect(container.querySelector('video')?.getAttribute('poster')).toBe(
      '/api/links/post/source-media/after-0-poster',
    );
  });
});
