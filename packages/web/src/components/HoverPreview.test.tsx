import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  githubSourceData,
  hackerNewsSourceData,
  makeLink,
  youtubeSourceData,
} from '../test/fixtures';
import { HoverPreview } from './HoverPreview';

const position = { top: 20, left: 40 };

describe('HoverPreview', () => {
  it('renders the generic variant: title, no tag line or note when absent', () => {
    render(
      <HoverPreview
        link={makeLink({ title: 'A great read', tags: [], notes: null })}
        position={position}
        onKeep={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    expect(screen.getByText('A great read')).toBeDefined();
    expect(screen.queryByText(/^#/)).toBeNull();
    expect(screen.queryByText(/^".*"$/)).toBeNull();
  });

  it('renders the tag line (space-joined #tag tokens) when tags are present', () => {
    render(
      <HoverPreview
        link={makeLink({ tags: ['ai', 'mcp'] })}
        position={position}
        onKeep={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    // RTL's default text matcher normalizes whitespace, so the DOM's actual
    // double-space join (`'#ai  #mcp'`, matching v3's `.join('  ')`) is
    // asserted against the raw textContent instead of `getByText`.
    expect(screen.getByText((_, node) => node?.textContent === '#ai  #mcp')).toBeDefined();
  });

  it('renders the quoted, italicized note when present', () => {
    render(
      <HoverPreview
        link={makeLink({ notes: 'read this later' })}
        position={position}
        onKeep={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    const note = screen.getByText('"read this later"');
    expect(note).toBeDefined();
    expect(note.style.fontStyle).toBe('italic');
  });

  it('falls back to the scheme-stripped url as the title when title is null', () => {
    render(
      <HoverPreview
        link={makeLink({ title: null, url: 'https://example.com/some-post' })}
        position={position}
        onKeep={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    expect(screen.getByText('example.com/some-post')).toBeDefined();
  });

  it('footer shows the derived domain (www. stripped)', () => {
    render(
      <HoverPreview
        link={makeLink({ url: 'https://www.example.com/x' })}
        position={position}
        onKeep={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    expect(screen.getByText('example.com')).toBeDefined();
  });

  it('footer meta reads "just now" for a link created at the current instant', () => {
    const now = new Date('2026-07-05T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      render(
        <HoverPreview
          link={makeLink({ createdAt: now.toISOString() })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
      );
      expect(screen.getByText('just now')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the footer "Open ↗" is a real anchor with the correct href/target/rel', () => {
    render(
      <HoverPreview
        link={makeLink({ url: 'https://example.com/x' })}
        position={position}
        onKeep={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    const anchor = screen.getByRole('link', { name: 'Open ↗' }) as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('https://example.com/x');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener');
  });

  it('is positioned at the given fixed top/left', () => {
    render(
      <HoverPreview
        link={makeLink()}
        position={{ top: 77, left: 88 }}
        onKeep={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    const card = screen.getByText('Example').closest('div[style*="position: fixed"]');
    expect(card).not.toBeNull();
    expect((card as HTMLElement).style.top).toBe('77px');
    expect((card as HTMLElement).style.left).toBe('88px');
  });

  it('does not render a close button — the popover dismisses on mouse-leave', () => {
    render(
      <HoverPreview link={makeLink()} position={position} onKeep={vi.fn()} onHide={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /close preview/i })).toBeNull();
  });

  it('calls onHide when the pointer leaves the card', () => {
    const onHide = vi.fn();
    render(<HoverPreview link={makeLink()} position={position} onKeep={vi.fn()} onHide={onHide} />);
    const card = screen
      .getByText('Example')
      .closest('div[style*="position: fixed"]') as HTMLElement;
    fireEvent.mouseLeave(card);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('is portaled to document.body', () => {
    const { baseElement } = render(
      <HoverPreview link={makeLink()} position={position} onKeep={vi.fn()} onHide={vi.fn()} />,
    );
    // baseElement is document.body itself in jsdom; the card should be a
    // direct(ish) child of body, not nested under the render container.
    expect(baseElement.querySelector('div[style*="z-index: 36"]')).not.toBeNull();
  });

  describe('rich variants (plan 012 phase 2)', () => {
    it('renders the HN variant: title, ▲points, and comments — the footer still shown', () => {
      render(
        <HoverPreview
          link={makeLink({
            title: 'Show HN: I built a thing',
            sourceData: hackerNewsSourceData,
            url: 'https://news.ycombinator.com/item?id=1',
          })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
      );
      expect(screen.getByText('Show HN: I built a thing')).toBeDefined();
      expect(screen.getByText('▲ 342 points')).toBeDefined();
      expect(screen.getByText('128 comments')).toBeDefined();
      expect(screen.getByRole('link', { name: 'Open ↗' })).toBeDefined();
    });

    it('renders the GitHub variant: title/description, stats row, and a language bar+name', () => {
      render(
        <HoverPreview
          link={makeLink({
            title: 'modelcontextprotocol/servers',
            sourceData: githubSourceData,
            url: 'https://github.com/modelcontextprotocol/servers',
          })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
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
      render(
        <HoverPreview
          link={makeLink({
            title: 'some/repo',
            sourceData: { kind: 'github', stars: 1, forks: 0, issues: 0 },
          })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
      );
      expect(screen.queryByText('TypeScript')).toBeNull();
    });

    it('renders the YouTube variant: a proxied thumbnail img and the channel line', () => {
      render(
        <HoverPreview
          link={makeLink({
            id: 'abc-123',
            title: 'A great video',
            sourceData: youtubeSourceData,
            url: 'https://youtu.be/abc123',
          })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
      );
      expect(screen.getByText('A great video')).toBeDefined();
      expect(screen.getByText('Fireship')).toBeDefined();
      const img = document.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('/api/preview-image?linkId=abc-123');
    });

    it('YouTube variant falls back to a placeholder when the proxied image errors', () => {
      render(
        <HoverPreview
          link={makeLink({ id: 'abc-123', title: 'A great video', sourceData: youtubeSourceData })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
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
      const { rerender } = render(
        <HoverPreview
          link={makeLink({ id: 'video-a', title: 'Video A', sourceData: youtubeSourceData })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
      );
      fireEvent.error(document.querySelector('img') as HTMLImageElement);
      expect(screen.getByText('Video thumbnail')).toBeDefined();
      expect(document.querySelector('img')).toBeNull();

      rerender(
        <HoverPreview
          link={makeLink({ id: 'video-b', title: 'Video B', sourceData: youtubeSourceData })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
      );
      // Link B's image must be attempted again, not stuck on A's placeholder.
      const imgB = document.querySelector('img') as HTMLImageElement;
      expect(imgB).not.toBeNull();
      expect(imgB.getAttribute('src')).toBe('/api/preview-image?linkId=video-b');
      expect(screen.queryByText('Video thumbnail')).toBeNull();
    });

    it('falls back to the generic variant for a plain link (kind: "link")', () => {
      render(
        <HoverPreview
          link={makeLink({ title: 'A plain link', sourceData: { kind: 'link' } })}
          position={position}
          onKeep={vi.fn()}
          onHide={vi.fn()}
        />,
      );
      expect(screen.getByText('A plain link')).toBeDefined();
      expect(screen.queryByText(/points$/)).toBeNull();
      expect(document.querySelector('img')).toBeNull();
    });
  });
});
