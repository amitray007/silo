import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReaderNavigation } from '../components/reader/useReaderNavigation';
import { makeLink } from '../test/fixtures';
import { useDockHistory } from './useDockHistory';

vi.mock('../components/HoverPreviewContext', () => ({
  useHoverPreview: () => ({ dismissAll: () => {} }),
}));

const links = [makeLink({ id: 'a' }), makeLink({ id: 'b' })];
function Dock() {
  const [overlay, setOverlay] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  useDockHistory(
    overlay ?? (notes ? 'Notes' : null),
    (reason) => {
      if (reason === 'navigate') setNotes(false);
      if (overlay) setOverlay(null);
      else setNotes(false);
    },
    null,
  );
  return (
    <>
      <button type="button" onClick={() => setNotes(true)}>
        Notes
      </button>
      {notes && <aside aria-label="Notes">Notes open</aside>}
      <button type="button" onClick={() => setOverlay('Type')}>
        Type
      </button>
      <button type="button" onClick={() => setOverlay('Chat')}>
        Chat
      </button>
      {overlay && (
        <div role="dialog" aria-label={overlay}>
          <button type="button" onClick={() => setOverlay(null)}>
            Close overlay
          </button>
        </div>
      )}
    </>
  );
}
function Reader() {
  const nav = useReaderNavigation({
    links,
    loading: false,
    hasNextPage: false,
    fetchNextPage: undefined,
  });
  return (
    <>
      <output data-testid="article">{nav.selectedId ?? 'list'}</output>
      <button type="button" onClick={() => void nav.step(1)}>
        Next
      </button>
      <button type="button" onClick={() => void nav.step(-1)}>
        Previous
      </button>
      <button type="button" onClick={nav.close}>
        Reader back
      </button>
      {nav.selectedId && <Dock key={nav.selectedId} />}
    </>
  );
}
function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrowserRouter>
        <Reader />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}
async function back() {
  await act(async () => {
    const popped = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    window.history.back();
    await popped;
  });
}
beforeEach(() => {
  window.history.replaceState({ idx: 0, key: 'list' }, '', '/');
  window.history.pushState({ idx: 1, key: 'article', usr: { preserved: true } }, '', '/?link=a');
});
afterEach(async () => {
  cleanup();
  await waitFor(() => expect(window.history.state?.siloDock).toBeUndefined());
});

it.each(['Type', 'Chat'])('Back closes %s before leaving the reader', async (name) => {
  mount();
  fireEvent.click(screen.getByRole('button', { name }));
  expect(window.location.search).toBe('?link=a');
  expect(window.history.state.usr).toEqual({ preserved: true });
  await back();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByTestId('article').textContent).toBe('a');
  await back();
  expect(screen.getByTestId('article').textContent).toBe('list');
});
it('consumes a button close so the next Back leaves the reader', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close overlay' }));
  await waitFor(() => expect(window.history.state.siloDock).toBeUndefined());
  expect(screen.getByTestId('article').textContent).toBe('a');
  await back();
  expect(screen.getByTestId('article').textContent).toBe('list');
});
it('keeps Next, Previous and reader Back correct while an overlay is open', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByTestId('article').textContent).toBe('b'));
  expect(window.location.search).toBe('?link=b');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await waitFor(() => expect(screen.getByTestId('article').textContent).toBe('a'));
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reader back' }));
  await waitFor(() => expect(screen.getByTestId('article').textContent).toBe('list'));
  expect(window.location.search).toBe('');
});
it('waits for a pending close before reopening and handles a sheet switch', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  const closing = window.history.state.siloDock;
  fireEvent.click(screen.getByRole('button', { name: 'Close overlay' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
  await waitFor(() => {
    expect(window.history.state.siloDock).toBeDefined();
    expect(window.history.state.siloDock).not.toBe(closing);
  });
  await back();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  const first = window.history.state.siloDock;
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
  await waitFor(() => expect(window.history.state.siloDock).not.toBe(first));
  await waitFor(() => expect(window.history.state.siloDock).toBeDefined());
  await back();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(window.location.search).toBe('?link=a');
});

it('backs through the top sheet then Notes, and dismisses both before article navigation', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  const notesEntry = window.history.state.siloDock;
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  await waitFor(() => {
    expect(window.history.state.siloDock).toBeDefined();
    expect(window.history.state.siloDock).not.toBe(notesEntry);
  });
  await back();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Notes')).toBeTruthy();
  await waitFor(() => expect(window.history.state.siloDock).toBeDefined());
  await back();
  expect(screen.queryByLabelText('Notes')).toBeNull();
  expect(screen.getByTestId('article').textContent).toBe('a');
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  const reopened = window.history.state.siloDock;
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  await waitFor(() => {
    expect(window.history.state.siloDock).toBeDefined();
    expect(window.history.state.siloDock).not.toBe(reopened);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByTestId('article').textContent).toBe('b'));
  expect(window.history.state.siloDock).toBeUndefined();
  await back();
  expect(screen.getByTestId('article').textContent).toBe('a');
});
