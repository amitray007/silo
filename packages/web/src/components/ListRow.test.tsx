import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkJson } from '../api/types';
import { clearTitleReveal, registerTitleReveal } from '../lib/titleReveals';
import { makeLink } from '../test/fixtures';
import { ListRow } from './ListRow';

function Row({ link }: { link: LinkJson }) {
  return (
    <ListRow
      link={link}
      menuOpen={false}
      toggleMenu={() => {}}
      menu={() => null}
      onRemove={() => {}}
    />
  );
}

let nextId = 0;
let link: LinkJson;

function titleElement(container: HTMLElement) {
  const title = container.querySelector('.silo-row-title');
  if (!(title instanceof HTMLElement)) throw new Error('Missing row title');
  return title;
}

function animatedText(container: HTMLElement) {
  return titleElement(container).querySelector('[aria-hidden="true"]');
}

describe('list title enrichment reveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: false,
    }));
    link = makeLink({
      id: `title-reveal-${++nextId}`,
      title: 'Original',
      captureStatus: 'enriching',
    });
    registerTitleReveal(link.id, 'Original');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('scrambles a new settled title, preserves spaces, and finishes with exact text', () => {
    const { container, rerender } = render(<Row link={link} />);
    const final = 'Better title 42';
    rerender(<Row link={{ ...link, title: final, captureStatus: 'full' }} />);
    expect(animatedText(container)?.textContent).toBe('AAAAAA AAAAA AA');
    expect(screen.getByRole('link').getAttribute('data-enriching')).toBe('false');
    expect(titleElement(container).className).toBe('silo-row-title');

    act(() => vi.advanceTimersByTime(400));
    expect(animatedText(container)?.textContent?.slice(0, 7)).toBe('Better ');
    expect(animatedText(container)?.textContent).not.toBe(final);
    act(() => vi.advanceTimersByTime(400));
    expect(animatedText(container)).toBeNull();
    expect(titleElement(container).textContent).toBe(final);
  });

  it.each(['enriching', 'full'] as const)(
    'does not animate a first render that is %s',
    (captureStatus) => {
      const { container } = render(<Row link={{ ...link, captureStatus }} />);
      expect(animatedText(container)).toBeNull();
      expect(titleElement(container).textContent).toBe('Original');
    },
  );

  it('does not animate a title edit on a settled row', () => {
    const { container, rerender } = render(<Row link={{ ...link, captureStatus: 'full' }} />);
    rerender(<Row link={{ ...link, title: 'Owner edit', captureStatus: 'full' }} />);
    expect(animatedText(container)).toBeNull();
    expect(titleElement(container).textContent).toBe('Owner edit');
  });

  it('does not animate an unchanged title when enrichment finishes', () => {
    const { container, rerender } = render(<Row link={link} />);
    rerender(<Row link={{ ...link, captureStatus: 'full' }} />);
    expect(animatedText(container)).toBeNull();
    expect(titleElement(container).textContent).toBe('Original');
  });

  it('does not replay on remount, even if the first animation was interrupted', () => {
    const mounted = render(<Row link={link} />);
    const settled = { ...link, title: 'Finished title', captureStatus: 'full' as const };
    mounted.rerender(<Row link={settled} />);
    expect(animatedText(mounted.container)).not.toBeNull();
    mounted.unmount();
    const { container } = render(<Row link={settled} />);
    expect(animatedText(container)).toBeNull();
    expect(titleElement(container).textContent).toBe('Finished title');
  });

  it('does not animate when enrichment finished while the row was unmounted', () => {
    const mounted = render(<Row link={link} />);
    mounted.unmount();
    const { container } = render(
      <Row link={{ ...link, title: 'Finished offscreen', captureStatus: 'full' }} />,
    );
    expect(animatedText(container)).toBeNull();
  });

  it.each([null, 'https://example.com', 'example.com'])(
    'does not guess enrichment from the placeholder %s',
    (title) => {
      const { container, rerender } = render(
        <Row link={{ ...link, title, captureStatus: 'bare' }} />,
      );
      rerender(<Row link={{ ...link, title: 'Resolved title', captureStatus: 'partial' }} />);
      expect(animatedText(container)).toBeNull();
    },
  );

  it('reveals another enrichment of a previously settled row', () => {
    const { container, rerender } = render(<Row link={{ ...link, captureStatus: 'full' }} />);
    registerTitleReveal(link.id, 'Original');
    rerender(<Row link={link} />);
    rerender(<Row link={{ ...link, title: 'New enrichment', captureStatus: 'full' }} />);
    expect(animatedText(container)).not.toBeNull();
    act(() => vi.advanceTimersByTime(800));
    registerTitleReveal(link.id, 'New enrichment');
    rerender(<Row link={{ ...link, title: 'New enrichment' }} />);
    rerender(<Row link={{ ...link, title: 'Another title', captureStatus: 'full' }} />);
    expect(animatedText(container)).not.toBeNull();
  });

  it('does not animate enrichment without a local mutation', () => {
    clearTitleReveal(link.id);
    const { container, rerender } = render(<Row link={link} />);
    rerender(<Row link={{ ...link, title: 'From another tab', captureStatus: 'full' }} />);
    expect(animatedText(container)).toBeNull();
  });

  it('does not animate a different link when the row instance is reused', () => {
    const { container, rerender } = render(<Row link={link} />);
    rerender(
      <Row
        link={{ ...link, id: `${link.id}-other`, title: 'Other link', captureStatus: 'full' }}
      />,
    );
    expect(animatedText(container)).toBeNull();
  });

  it.each(['日本語のタイトル', 'हिन्दी का शीर्षक', 'A mixed 日本語 title'])(
    'fades %s without scrambling and finishes after 200 ms',
    (title) => {
      const { container, rerender } = render(<Row link={link} />);
      rerender(<Row link={{ ...link, title, captureStatus: 'full' }} />);
      expect(animatedText(container)?.className).toBe('silo-title-fade');
      expect(animatedText(container)?.textContent).toBe(title);
      act(() => vi.advanceTimersByTime(208));
      expect(animatedText(container)).toBeNull();
      expect(titleElement(container).textContent).toBe(title);
    },
  );

  it.each(['A final title', '日本語のタイトル'])(
    'swaps %s instantly with reduced motion',
    (title) => {
      const media = window.matchMedia('');
      vi.mocked(window.matchMedia).mockImplementation((query) => ({
        ...media,
        media: query,
        matches: query === '(prefers-reduced-motion: reduce)',
      }));
      const { container, rerender } = render(<Row link={link} />);
      rerender(<Row link={{ ...link, title, captureStatus: 'full' }} />);
      expect(animatedText(container)).toBeNull();
      expect(titleElement(container).textContent).toBe(title);
    },
  );

  it('keeps the final accessible title before, during, and after animation', () => {
    const { container, rerender } = render(<Row link={link} />);
    expect(screen.getByRole('link', { name: /^Original/ })).toBeDefined();
    rerender(<Row link={{ ...link, title: 'Accessible title', captureStatus: 'full' }} />);
    expect(animatedText(container)?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('link', { name: /^Accessible title/ })).toBeDefined();
    expect(titleElement(container).querySelector('.silo-sr-only')?.textContent).toBe(
      'Accessible title',
    );
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('link', { name: /^Accessible title/ })).toBeDefined();
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('link', { name: /^Accessible title/ })).toBeDefined();
  });

  it('reveals once under StrictMode', () => {
    const { container, rerender } = render(
      <StrictMode>
        <Row link={link} />
      </StrictMode>,
    );
    expect(animatedText(container)).toBeNull();
    rerender(
      <StrictMode>
        <Row link={{ ...link, title: 'Strict title', captureStatus: 'full' }} />
      </StrictMode>,
    );
    expect(animatedText(container)).not.toBeNull();
    act(() => vi.advanceTimersByTime(800));
    expect(titleElement(container).textContent).toBe('Strict title');
  });
});
