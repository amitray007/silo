import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkJson } from '../api/types';
import { clearTitleReveal, registerTitleReveal } from '../lib/titleReveals';
import { makeLink } from '../test/fixtures';
import { ListRow } from './ListRow';
import { ReaderSelectionContext } from './reader/ReaderSelection';

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

describe('row semantics and keyboard', () => {
  afterEach(cleanup);

  function renderIn(selectedId: string | null | undefined, row: LinkJson) {
    const ui = <Row link={row} />;
    if (selectedId === undefined) return render(ui);
    return render(
      <ReaderSelectionContext.Provider value={{ selectedId, select: () => {} }}>
        {ui}
      </ReaderSelectionContext.Provider>,
    );
  }

  it('keeps every button outside the row link', () => {
    renderIn(null, makeLink({ id: 'sem-1', title: 'Plain title' }));
    const row = screen.getByRole('link');
    expect(row.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('names the link by its title alone, and adds "Has note" when notes exist', () => {
    const { unmount } = renderIn(
      null,
      makeLink({ id: 'sem-2', title: 'Plain title', notes: null }),
    );
    expect(screen.getByRole('link').getAttribute('href')).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Plain title/ }).textContent).not.toContain(
      'Has note',
    );
    unmount();
    renderIn(null, makeLink({ id: 'sem-3', title: 'Plain title', notes: 'remember' }));
    expect(screen.getByRole('link', { name: /Plain title.*Has note/ })).toBeDefined();
    expect(
      screen.queryByRole('link', { name: /Open original|Move to trash|More actions/ }),
    ).toBeNull();
  });

  it('names the menu button "More actions"', () => {
    renderIn(null, makeLink({ id: 'sem-4' }));
    expect(screen.getByRole('button', { name: 'More actions' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Options' })).toBeNull();
  });

  it.each([
    ['another row is selected', 'other-row', -1],
    ['no row is selected', null, -1],
    ['this row is selected', 'sem-5', 0],
    ['there is no reader context', undefined, 0],
  ] as const)('sets the action tab stops when %s', (_name, selectedId, expected) => {
    renderIn(selectedId, makeLink({ id: 'sem-5' }));
    for (const button of screen.getAllByRole('button')) {
      expect(button.tabIndex).toBe(expected);
    }
  });

  it('keeps hover on the row while the pointer moves onto the actions', () => {
    const onLeave = vi.fn();
    const onEnter = vi.fn();
    const row = makeLink({ id: 'sem-6' });
    render(
      <ListRow
        link={row}
        menuOpen={false}
        toggleMenu={() => {}}
        menu={() => null}
        onRemove={() => {}}
        onEnter={onEnter}
        onLeave={onLeave}
      />,
    );
    const anchor = screen.getByRole('link');
    const button = screen.getByRole('button', { name: 'More actions' });
    fireEvent.mouseEnter(anchor);
    expect(onEnter).toHaveBeenCalledTimes(1);
    fireEvent.mouseEnter(button, { relatedTarget: anchor });
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.focus(anchor);
    fireEvent.blur(anchor, { relatedTarget: button });
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.blur(button, { relatedTarget: document.body });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

it.each([
  [{ source: 'feed', feedId: null }, true],
  [{ source: 'web', feedId: 'feed-123' }, false],
] as const)(
  'keeps More actions and scopes the triage action by membership: %j',
  (fields, editable) => {
    render(<Row link={makeLink(fields)} />);
    expect(screen.getByRole('button', { name: 'More actions' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Move to trash' }) !== null).toBe(editable);
    expect(screen.queryByRole('button', { name: 'Archive' }) !== null).toBe(!editable);
  },
);
