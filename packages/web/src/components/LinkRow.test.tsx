import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { makeLink } from '../test/fixtures';
import { LinkRow } from './LinkRow';
import { RowMenuProvider } from './RowMenuContext';

function link(overrides: Parameters<typeof makeLink>[0] = {}) {
  return makeLink({ url: 'https://www.example.com/a-post', title: 'A post', ...overrides });
}

/** `LinkRow` reads `useRowMenu()` for its `⋯` button (plan 011, V3-4) — every render needs a `RowMenuProvider` ancestor; the `⋯` menu's tag hooks need a `QueryClientProvider` too. */
function renderRow(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>{ui}</RowMenuProvider>
    </QueryClientProvider>,
  );
}

describe('LinkRow', () => {
  it('renders the title when present', () => {
    renderRow(<LinkRow link={link({ title: 'A post' })} />);
    expect(screen.getByText('A post')).toBeDefined();
  });

  it('falls back to the scheme-stripped url when title is null', () => {
    renderRow(<LinkRow link={link({ title: null, url: 'https://www.example.com/a-post' })} />);
    expect(screen.getByText('www.example.com/a-post')).toBeDefined();
  });

  it('renders the derived domain suffix (www. stripped)', () => {
    renderRow(<LinkRow link={link({ url: 'https://www.example.com/a-post' })} />);
    expect(screen.getByText('example.com')).toBeDefined();
  });

  it('is a real anchor to the link url, opening in a new tab safely', () => {
    renderRow(<LinkRow link={link({ url: 'https://example.com/x' })} />);
    const anchor = screen.getByRole('link') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('https://example.com/x');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener');
  });

  it('shows no mark at all on a healthy full link with no notes, not agent-added — silence means complete', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'full', notes: null, addedBy: 'user' })} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the enriching mark and dims the title while capturing', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'enriching' })} />);
    expect(screen.getByLabelText('capturing…')).toBeDefined();
    expect(screen.getByText('A post').style.color).toBe('var(--fnt)');
  });

  it('shows the degraded mark for a partial capture', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'partial' })} />);
    expect(screen.getByLabelText('capture incomplete')).toBeDefined();
  });

  it('shows the degraded mark for a bare capture', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'bare' })} />);
    expect(screen.getByLabelText('capture incomplete')).toBeDefined();
  });

  it('shows the note mark when notes are present', () => {
    renderRow(<LinkRow link={link({ notes: 'read later' })} />);
    expect(screen.getByLabelText('has a note')).toBeDefined();
  });

  it('shows the claude mark when addedBy is agent', () => {
    renderRow(<LinkRow link={link({ addedBy: 'agent' })} />);
    expect(screen.getByLabelText('added by Claude')).toBeDefined();
  });

  it('composes note + claude + enriching together (a 3-mark combo)', () => {
    renderRow(
      <LinkRow link={link({ notes: 'context', addedBy: 'agent', captureStatus: 'enriching' })} />,
    );
    expect(screen.getByLabelText('has a note')).toBeDefined();
    expect(screen.getByLabelText('added by Claude')).toBeDefined();
    expect(screen.getByLabelText('capturing…')).toBeDefined();
  });

  it('renders the note line, quoted, only when notes are present', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <LinkRow link={link({ notes: 'a comment' })} />
        </RowMenuProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('"a comment"')).toBeDefined();

    rerender(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <LinkRow link={link({ notes: null })} />
        </RowMenuProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('"a comment"')).toBeNull();
  });

  it('treats empty-string notes like no note — no mark, no note line, no empty quotes', () => {
    // '' is falsy, so the guard (`link.notes && …`) must render nothing — not a
    // stray note mark or an empty `""`. Pins the behavior against a future
    // refactor to a null-only check.
    renderRow(<LinkRow link={link({ notes: '', captureStatus: 'full', addedBy: 'user' })} />);
    expect(screen.queryByLabelText('has a note')).toBeNull();
    expect(screen.queryByText('""')).toBeNull();
  });

  it('never uses the amber mark/markt color tokens outside of a Mark glyph (no amber chrome)', () => {
    const { container } = renderRow(
      <LinkRow link={link({ notes: 'x', addedBy: 'agent', captureStatus: 'partial' })} />,
    );
    const markEls = new Set(screen.getAllByRole('img'));

    for (const el of container.querySelectorAll<HTMLElement>('*')) {
      const color = el.style.color;
      if (color === 'var(--mark)' || color === 'var(--markt)') {
        expect(markEls.has(el)).toBe(true);
      }
    }
  });

  it('the ⋯ button opens the row menu without navigating (stopPropagation on mousedown+click)', () => {
    renderRow(<LinkRow link={link()} />);
    const optionsButton = screen.getByTitle('options');
    fireEvent.click(optionsButton);
    expect(screen.getByText('move to trash')).toBeDefined();
  });
});
