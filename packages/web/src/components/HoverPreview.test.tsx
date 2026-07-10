import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/hooks';
import type { LinkJson, SettingsMap } from '../api/types';
import {
  githubSourceData,
  hackerNewsSourceData,
  makeLink,
  twitterSourceData,
  youtubeSourceData,
} from '../test/fixtures';
import { HoverPreview } from './HoverPreview';

const position = { top: 20, left: 40 };

/**
 * Renders `HoverPreview` inside a fresh `QueryClientProvider` — plan 026
 * added a `useSettings()` call to the component, so every render needs a
 * QueryClient ancestor now. `plugins` is optional: when omitted, no settings
 * are seeded and `useSettings()` stays in its loading state, matching the
 * app's `?? true` optimistic default (rich variant shows) — that's the
 * existing tests' original intent, so they pass `plugins` unset. `linkPreviewImages`
 * defaults to `true` (matching `SETTINGS_DEFAULTS`) when `plugins` is seeded;
 * pass `false` explicitly to exercise the silo section's off gate.
 */
function renderPreview(link: LinkJson, plugins?: SettingsMap['plugins'], linkPreviewImages = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (plugins) {
    queryClient.setQueryData(queryKeys.settings(), {
      theme: 'system',
      trashPurgeDays: 30,
      mcpAccess: true,
      linkPreviewImages,
      plugins,
    } satisfies SettingsMap);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <HoverPreview link={link} position={position} onKeep={vi.fn()} onHide={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('HoverPreview', () => {
  it('renders the generic variant: title, no tag line or note when absent', () => {
    renderPreview(makeLink({ title: 'A great read', tags: [], notes: null }));
    expect(screen.getByText('A great read')).toBeDefined();
    expect(screen.queryByText(/^#/)).toBeNull();
    expect(screen.queryByText(/^".*"$/)).toBeNull();
  });

  it('renders the tag line (space-joined #tag tokens) when tags are present', () => {
    renderPreview(makeLink({ tags: ['ai', 'mcp'] }));
    // RTL's default text matcher normalizes whitespace, so the DOM's actual
    // double-space join (`'#ai  #mcp'`, matching v3's `.join('  ')`) is
    // asserted against the raw textContent instead of `getByText`.
    expect(screen.getByText((_, node) => node?.textContent === '#ai  #mcp')).toBeDefined();
  });

  it('does NOT render the note (the row already shows it — no double display)', () => {
    // The note lives on the row (LinkRow's quoted line); the hover card sits
    // right beside the row, so showing the note in both was pure duplication.
    // Guard against it regressing back into the hover.
    renderPreview(makeLink({ notes: 'read this later' }));
    expect(screen.queryByText('"read this later"')).toBeNull();
  });

  it('falls back to the scheme-stripped url as the title when title is null', () => {
    renderPreview(makeLink({ title: null, url: 'https://example.com/some-post' }));
    expect(screen.getByText('example.com/some-post')).toBeDefined();
  });

  it('footer shows the derived domain (www. stripped)', () => {
    renderPreview(makeLink({ url: 'https://www.example.com/x' }));
    expect(screen.getByText('example.com')).toBeDefined();
  });

  it('footer meta reads "just now" for a link created at the current instant', () => {
    const now = new Date('2026-07-05T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      renderPreview(makeLink({ createdAt: now.toISOString() }));
      expect(screen.getByText('just now')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the footer "Open ↗" is a real anchor with the correct href/target/rel', () => {
    renderPreview(makeLink({ url: 'https://example.com/x' }));
    const anchor = screen.getByRole('link', { name: 'Open ↗' }) as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('https://example.com/x');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener');
  });

  it('is positioned at the given fixed top/left', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <HoverPreview
          link={makeLink()}
          position={{ top: 77, left: 88 }}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const card = screen.getByText('Example').closest('div[style*="position: fixed"]');
    expect(card).not.toBeNull();
    expect((card as HTMLElement).style.top).toBe('77px');
    expect((card as HTMLElement).style.left).toBe('88px');
  });

  it('does not render a close button — the popover dismisses on mouse-leave', () => {
    renderPreview(makeLink());
    expect(screen.queryByRole('button', { name: /close preview/i })).toBeNull();
  });

  it('calls onHide when the pointer leaves the card', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onHide = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <HoverPreview link={makeLink()} position={position} onKeep={vi.fn()} onHide={onHide} />
      </QueryClientProvider>,
    );
    const card = screen
      .getByText('Example')
      .closest('div[style*="position: fixed"]') as HTMLElement;
    fireEvent.mouseLeave(card);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('is portaled to document.body', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { baseElement } = render(
      <QueryClientProvider client={queryClient}>
        <HoverPreview link={makeLink()} position={position} onKeep={vi.fn()} onHide={vi.fn()} />
      </QueryClientProvider>,
    );
    // baseElement is document.body itself in jsdom; the card should be a
    // direct(ish) child of body, not nested under the render container.
    expect(baseElement.querySelector('div[style*="z-index: 36"]')).not.toBeNull();
  });

  describe('rich variants (plan 012 phase 2)', () => {
    it('renders the HN variant: title, ▲points, and comments — the footer still shown', () => {
      renderPreview(
        makeLink({
          title: 'Show HN: I built a thing',
          sourceData: hackerNewsSourceData,
          url: 'https://news.ycombinator.com/item?id=1',
        }),
      );
      expect(screen.getByText('Show HN: I built a thing')).toBeDefined();
      expect(screen.getByText('▲ 342 points')).toBeDefined();
      expect(screen.getByText('128 comments')).toBeDefined();
      expect(screen.getByRole('link', { name: 'Open ↗' })).toBeDefined();
    });

    it('renders the GitHub variant: title/description, stats row, and a language bar+name', () => {
      renderPreview(
        makeLink({
          title: 'modelcontextprotocol/servers',
          sourceData: githubSourceData,
          url: 'https://github.com/modelcontextprotocol/servers',
        }),
      );
      expect(screen.getByText('modelcontextprotocol/servers')).toBeDefined();
      expect(
        screen.getByText('Reference implementations for the Model Context Protocol'),
      ).toBeDefined();
      expect(screen.getByText('58100')).toBeDefined();
      expect(screen.getByText('6600')).toBeDefined();
      expect(screen.getByText('412')).toBeDefined();
      expect(screen.getByText('stars')).toBeDefined();
      expect(screen.getByText('forks')).toBeDefined();
      expect(screen.getByText('issues')).toBeDefined();
      expect(screen.getByText('TypeScript')).toBeDefined();
    });

    it('GitHub variant omits the language bar entirely when language is absent', () => {
      renderPreview(
        makeLink({
          title: 'some/repo',
          sourceData: { kind: 'github', stars: 1, forks: 0, issues: 0 },
        }),
      );
      expect(screen.queryByText('TypeScript')).toBeNull();
    });

    it('renders the YouTube variant: a proxied thumbnail img and the channel line', () => {
      renderPreview(
        makeLink({
          id: 'abc-123',
          title: 'A great video',
          sourceData: youtubeSourceData,
          url: 'https://youtu.be/abc123',
        }),
      );
      expect(screen.getByText('A great video')).toBeDefined();
      expect(screen.getByText('Fireship')).toBeDefined();
      const img = document.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('/api/preview-image?linkId=abc-123');
    });

    it('YouTube variant falls back to a placeholder when the proxied image errors', () => {
      renderPreview(
        makeLink({ id: 'abc-123', title: 'A great video', sourceData: youtubeSourceData }),
      );
      const img = document.querySelector('img') as HTMLImageElement;
      fireEvent.error(img);
      expect(screen.getByText('Video thumbnail')).toBeDefined();
      expect(document.querySelector('img')).toBeNull();
    });

    it('resets the image-failed state when the previewed YouTube link changes (no stale placeholder leak)', () => {
      // Regression (ce-correctness-reviewer): the shared HoverPreview instance
      // is reused across links without a `key`, so a `true` imageFailed from
      // link A must not suppress link B's thumbnail. Re-rendering the SAME
      // element position with a new link id simulates the reuse.
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <HoverPreview
            link={makeLink({ id: 'video-a', title: 'Video A', sourceData: youtubeSourceData })}
            position={position}
            onKeep={vi.fn()}
            onHide={vi.fn()}
          />
        </QueryClientProvider>,
      );
      fireEvent.error(document.querySelector('img') as HTMLImageElement);
      expect(screen.getByText('Video thumbnail')).toBeDefined();
      expect(document.querySelector('img')).toBeNull();

      rerender(
        <QueryClientProvider client={queryClient}>
          <HoverPreview
            link={makeLink({ id: 'video-b', title: 'Video B', sourceData: youtubeSourceData })}
            position={position}
            onKeep={vi.fn()}
            onHide={vi.fn()}
          />
        </QueryClientProvider>,
      );
      // Link B's image must be attempted again, not stuck on A's placeholder.
      const imgB = document.querySelector('img') as HTMLImageElement;
      expect(imgB).not.toBeNull();
      expect(imgB.getAttribute('src')).toBe('/api/preview-image?linkId=video-b');
      expect(screen.queryByText('Video thumbnail')).toBeNull();
    });

    it('falls back to the generic variant for a plain link (kind: "link")', () => {
      renderPreview(makeLink({ title: 'A plain link', sourceData: { kind: 'link' } }));
      expect(screen.getByText('A plain link')).toBeDefined();
      expect(screen.queryByText(/points$/)).toBeNull();
      expect(document.querySelector('img')).toBeNull();
    });

    it('renders the Twitter variant: author name/handle, tweet text, and engagement counts (icon + number)', () => {
      renderPreview(
        makeLink({
          title: 'Amit Ray on X',
          sourceData: twitterSourceData,
          url: 'https://x.com/amitray007/status/1',
        }),
      );
      expect(screen.getByText('Amit Ray')).toBeDefined();
      expect(screen.getByText('@amitray007')).toBeDefined();
      expect(
        screen.getByText('Just shipped a new feature — thrilled with how it turned out.'),
      ).toBeDefined();
      // Counts render as icon+number, not a text glyph prefix — assert the
      // bare numbers (each engagement stat is its own <span>).
      expect(screen.getByText('512')).toBeDefined();
      expect(screen.getByText('48')).toBeDefined();
      expect(screen.getByText('23')).toBeDefined();
      expect(screen.getByRole('link', { name: 'Open ↗' })).toBeDefined();
    });

    it('does NOT render the redundant page-title header ("Amit Ray on X") — only the author line + tweet text', () => {
      renderPreview(
        makeLink({
          title: 'Amit Ray (@amitray007) on X',
          sourceData: twitterSourceData,
          url: 'https://x.com/amitray007/status/1',
        }),
      );
      // The author name appears exactly once (the author line), not also as
      // a page-title header repeating the same name.
      expect(screen.getAllByText('Amit Ray')).toHaveLength(1);
      expect(screen.queryByText('Amit Ray (@amitray007) on X')).toBeNull();
      expect(screen.queryByText(/on X$/)).toBeNull();
    });

    it('the engagement row uses one consistent SVG icon set (heart/repost/reply), not mismatched emoji', () => {
      renderPreview(
        makeLink({
          title: 'Amit Ray on X',
          sourceData: twitterSourceData,
          url: 'https://x.com/amitray007/status/1',
        }),
      );
      // Three matched inline SVGs (14x14, same stroke/viewBox), no emoji glyph.
      const svgs = Array.from(document.querySelectorAll('svg')).filter(
        (svg) => svg.getAttribute('width') === '14' && svg.getAttribute('height') === '14',
      );
      expect(svgs).toHaveLength(3);
      for (const svg of svgs) {
        expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
        expect(svg.getAttribute('stroke-width')).toBe('1.5');
      }
      expect(screen.queryByText(/💬/)).toBeNull();
      expect(screen.queryByText(/♥/)).toBeNull();
      expect(screen.queryByText(/↻/)).toBeNull();
    });

    it('Twitter variant never renders a raw <img> (no third-party twimg.com calls) even with an avatar url present', () => {
      renderPreview(
        makeLink({
          title: 'Amit Ray on X',
          sourceData: { ...twitterSourceData, authorAvatarUrl: 'https://pbs.twimg.com/a.jpg' },
        }),
      );
      expect(document.querySelector('img')).toBeNull();
    });

    it('renders the tweet media thumbnail via the preview-image proxy (never a raw twimg.com src) when thumbnailUrl is present', () => {
      renderPreview(
        makeLink({
          id: 'link-with-media',
          title: 'Amit Ray on X',
          sourceData: {
            ...twitterSourceData,
            thumbnailUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/1/thumb.jpg',
          },
        }),
      );
      const img = document.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('/api/preview-image?linkId=link-with-media');
    });

    it('omits the image entirely for a text-only tweet (no thumbnailUrl)', () => {
      renderPreview(
        makeLink({
          title: 'Amit Ray on X',
          sourceData: twitterSourceData, // fixture has no thumbnailUrl
        }),
      );
      expect(document.querySelector('img')).toBeNull();
    });
  });

  describe('plugin hover gate (plan 026)', () => {
    const allOn: SettingsMap['plugins'] = {
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
      twitter: { enabled: true, inline: true, hover: true },
    };

    it('github: hover:false falls back to the generic variant (repo stats absent, generic card shown)', () => {
      renderPreview(
        makeLink({
          title: 'modelcontextprotocol/servers',
          sourceData: githubSourceData,
          url: 'https://github.com/modelcontextprotocol/servers',
        }),
        { ...allOn, github: { enabled: true, hover: false } },
      );
      // RepoVariant's stats row is absent.
      expect(screen.queryByText('58100')).toBeNull();
      expect(screen.queryByText('stars')).toBeNull();
      expect(screen.queryByText('TypeScript')).toBeNull();
      // GenericVariant shows the title instead.
      expect(screen.getByText('modelcontextprotocol/servers')).toBeDefined();
    });

    it('github: enabled:false (master off) also falls back to the generic variant', () => {
      renderPreview(
        makeLink({
          title: 'modelcontextprotocol/servers',
          sourceData: githubSourceData,
          url: 'https://github.com/modelcontextprotocol/servers',
        }),
        { ...allOn, github: { enabled: false, hover: true } },
      );
      expect(screen.queryByText('58100')).toBeNull();
      expect(screen.queryByText('stars')).toBeNull();
      expect(screen.getByText('modelcontextprotocol/servers')).toBeDefined();
    });

    it('github: enabled:true && hover:true renders the RepoVariant', () => {
      renderPreview(
        makeLink({
          title: 'modelcontextprotocol/servers',
          sourceData: githubSourceData,
          url: 'https://github.com/modelcontextprotocol/servers',
        }),
        allOn,
      );
      expect(screen.getByText('58100')).toBeDefined();
      expect(screen.getByText('stars')).toBeDefined();
      expect(screen.getByText('TypeScript')).toBeDefined();
    });

    it('youtube: hover:false falls back to the generic variant (VideoVariant absent)', () => {
      renderPreview(
        makeLink({
          id: 'abc-123',
          title: 'A great video',
          sourceData: youtubeSourceData,
          url: 'https://youtu.be/abc123',
        }),
        { ...allOn, youtube: { enabled: true, hover: false } },
      );
      // VideoVariant's channel line and img are absent.
      expect(screen.queryByText('Fireship')).toBeNull();
      expect(document.querySelector('img')).toBeNull();
      // GenericVariant shows the title instead.
      expect(screen.getByText('A great video')).toBeDefined();
    });

    it('youtube: enabled:true && hover:true renders the VideoVariant', () => {
      renderPreview(
        makeLink({
          id: 'abc-123',
          title: 'A great video',
          sourceData: youtubeSourceData,
          url: 'https://youtu.be/abc123',
        }),
        allOn,
      );
      expect(screen.getByText('Fireship')).toBeDefined();
      const img = document.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('/api/preview-image?linkId=abc-123');
    });

    it('hacker_news: hover:false falls back to the generic variant (HnVariant points/comments absent)', () => {
      renderPreview(
        makeLink({
          title: 'Show HN: I built a thing',
          sourceData: hackerNewsSourceData,
          url: 'https://news.ycombinator.com/item?id=1',
        }),
        { ...allOn, hacker_news: { enabled: true, inline: true, hover: false } },
      );
      expect(screen.queryByText('▲ 342 points')).toBeNull();
      expect(screen.queryByText('128 comments')).toBeNull();
      expect(screen.getByText('Show HN: I built a thing')).toBeDefined();
    });

    it('hacker_news: enabled:true && hover:true renders the HnVariant', () => {
      renderPreview(
        makeLink({
          title: 'Show HN: I built a thing',
          sourceData: hackerNewsSourceData,
          url: 'https://news.ycombinator.com/item?id=1',
        }),
        allOn,
      );
      expect(screen.getByText('▲ 342 points')).toBeDefined();
      expect(screen.getByText('128 comments')).toBeDefined();
    });

    it('twitter: hover:false falls back to the generic variant (TwitterVariant absent)', () => {
      renderPreview(
        makeLink({
          title: 'Amit Ray on X',
          sourceData: twitterSourceData,
          url: 'https://x.com/amitray007/status/1',
        }),
        { ...allOn, twitter: { enabled: true, inline: false, hover: false } },
      );
      expect(screen.queryByText('@amitray007')).toBeNull();
      expect(screen.queryByText('♥ 512')).toBeNull();
      expect(screen.getByText('Amit Ray on X')).toBeDefined();
    });

    it('twitter: enabled:false (master off) also falls back to the generic variant', () => {
      renderPreview(
        makeLink({
          title: 'Amit Ray on X',
          sourceData: twitterSourceData,
          url: 'https://x.com/amitray007/status/1',
        }),
        { ...allOn, twitter: { enabled: false, inline: true, hover: true } },
      );
      expect(screen.queryByText('@amitray007')).toBeNull();
      expect(screen.getByText('Amit Ray on X')).toBeDefined();
    });

    it('twitter: enabled:true && hover:true renders the TwitterVariant', () => {
      renderPreview(
        makeLink({
          title: 'Amit Ray on X',
          sourceData: twitterSourceData,
          url: 'https://x.com/amitray007/status/1',
        }),
        allOn,
      );
      expect(screen.getByText('@amitray007')).toBeDefined();
      expect(screen.getByText('512')).toBeDefined();
    });

    it('loading default (no settings seeded): the rich variant renders (optimistic ?? true)', () => {
      renderPreview(
        makeLink({
          title: 'modelcontextprotocol/servers',
          sourceData: githubSourceData,
          url: 'https://github.com/modelcontextprotocol/servers',
        }),
      );
      expect(screen.getByText('58100')).toBeDefined();
      expect(screen.getByText('stars')).toBeDefined();
    });
  });

  describe('silo section: og:image in the generic (plain-link) variant', () => {
    const allOn: SettingsMap['plugins'] = {
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
      twitter: { enabled: true, inline: true, hover: true },
    };

    it('renders the proxied cover image when imageUrl is present and linkPreviewImages is true', () => {
      renderPreview(
        makeLink({
          id: 'link-with-image',
          title: 'A plain link',
          sourceData: { kind: 'link' },
          imageUrl: 'https://example.com/og.png',
        }),
        allOn,
      );
      const img = document.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('/api/preview-image?linkId=link-with-image');
    });

    it('omits the image when linkPreviewImages is false, even with imageUrl present', () => {
      renderPreview(
        makeLink({
          id: 'link-with-image',
          title: 'A plain link',
          sourceData: { kind: 'link' },
          imageUrl: 'https://example.com/og.png',
        }),
        allOn,
        false,
      );
      expect(document.querySelector('img')).toBeNull();
      expect(screen.getByText('A plain link')).toBeDefined();
    });

    it('omits the image when imageUrl is absent, even with linkPreviewImages true', () => {
      renderPreview(
        makeLink({
          title: 'A plain link',
          sourceData: { kind: 'link' },
          imageUrl: null,
        }),
        allOn,
      );
      expect(document.querySelector('img')).toBeNull();
    });

    it('shows the image by default while settings are still loading (optimistic, not explicitly false)', () => {
      // No settings seeded at all — renderPreview's default path.
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <HoverPreview
            link={makeLink({
              id: 'link-with-image',
              title: 'A plain link',
              sourceData: { kind: 'link' },
              imageUrl: 'https://example.com/og.png',
            })}
            position={position}
            onKeep={vi.fn()}
            onHide={vi.fn()}
          />
        </QueryClientProvider>,
      );
      const img = document.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('/api/preview-image?linkId=link-with-image');
    });

    it('falls back gracefully (no image) when the proxied cover image errors', () => {
      renderPreview(
        makeLink({
          id: 'link-with-image',
          title: 'A plain link',
          sourceData: { kind: 'link' },
          imageUrl: 'https://example.com/og.png',
        }),
        allOn,
      );
      const img = document.querySelector('img') as HTMLImageElement;
      fireEvent.error(img);
      expect(document.querySelector('img')).toBeNull();
      expect(screen.getByText('A plain link')).toBeDefined();
    });

    it('resets the image-failed state when the previewed link changes (no stale placeholder leak)', () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(queryKeys.settings(), {
        theme: 'system',
        trashPurgeDays: 30,
        mcpAccess: true,
        linkPreviewImages: true,
        plugins: allOn,
      } satisfies SettingsMap);
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <HoverPreview
            link={makeLink({
              id: 'link-a',
              title: 'Link A',
              sourceData: { kind: 'link' },
              imageUrl: 'https://example.com/a.png',
            })}
            position={position}
            onKeep={vi.fn()}
            onHide={vi.fn()}
          />
        </QueryClientProvider>,
      );
      fireEvent.error(document.querySelector('img') as HTMLImageElement);
      expect(document.querySelector('img')).toBeNull();

      rerender(
        <QueryClientProvider client={queryClient}>
          <HoverPreview
            link={makeLink({
              id: 'link-b',
              title: 'Link B',
              sourceData: { kind: 'link' },
              imageUrl: 'https://example.com/b.png',
            })}
            position={position}
            onKeep={vi.fn()}
            onHide={vi.fn()}
          />
        </QueryClientProvider>,
      );
      const imgB = document.querySelector('img') as HTMLImageElement;
      expect(imgB).not.toBeNull();
      expect(imgB.getAttribute('src')).toBe('/api/preview-image?linkId=link-b');
    });
  });
});
