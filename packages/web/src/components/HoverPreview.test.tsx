import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
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

  it('the footer "open ↗" is a real anchor with the correct href/target/rel', () => {
    render(
      <HoverPreview
        link={makeLink({ url: 'https://example.com/x' })}
        position={position}
        onKeep={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    const anchor = screen.getByRole('link', { name: 'open ↗' }) as HTMLAnchorElement;
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

  it('is portaled to document.body', () => {
    const { baseElement } = render(
      <HoverPreview link={makeLink()} position={position} onKeep={vi.fn()} onHide={vi.fn()} />,
    );
    // baseElement is document.body itself in jsdom; the card should be a
    // direct(ish) child of body, not nested under the render container.
    expect(baseElement.querySelector('div[style*="z-index: 36"]')).not.toBeNull();
  });
});
