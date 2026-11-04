import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layoutMedia } from '../../lib/breakpoints';
import { makeLink } from '../../test/fixtures';
import { HoverPreviewProvider } from '../HoverPreviewContext';
import { RowMenuProvider } from '../RowMenuContext';
import { ReaderLayout } from './ReaderLayout';
import { useReaderSelection } from './ReaderSelection';

let ready = true;
vi.mock('../../api/librarian', () => ({ useLibrarianReady: () => ready }));
vi.mock('./librarian/LibraryChatPane', () => ({
  LibraryChatPane: ({
    chatId,
    onBack,
    onCreated,
  }: {
    chatId: string | null;
    onBack: () => void;
    onCreated: (id: string) => void;
  }) => (
    <section aria-label="Librarian chat">
      <output data-testid="chat-id">{chatId ?? 'none'}</output>
      <button type="button" onClick={onBack}>
        Back
      </button>
      <button type="button" onClick={() => onCreated('made')}>
        Created
      </button>
    </section>
  ),
}));

const first = makeLink({ id: 'a', title: 'First link', url: 'https://example.com/a' });

function OpenFirst() {
  const selection = useReaderSelection();
  return (
    <button type="button" onClick={() => selection?.select('a')}>
      Open first
    </button>
  );
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function setup({
  path = '/',
  trashed = false,
  narrow = false,
}: {
  path?: string;
  trashed?: boolean;
  narrow?: boolean;
} = {}) {
  const media = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...media(query),
    matches: narrow && query === layoutMedia.fullWindowReader,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ link: first }))),
  );
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <RowMenuProvider>
          <HoverPreviewProvider>
            <ReaderLayout links={[first]} title="Library" trashed={trashed}>
              <OpenFirst />
            </ReaderLayout>
            <Where />
          </HoverPreviewProvider>
        </RowMenuProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ready = true;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pane = () => document.querySelector('.silo-three-pane');

it('shows a new chat in the right pane when no link is open', () => {
  setup();
  expect(screen.getByRole('region', { name: 'Librarian chat' })).toBeDefined();
  expect(screen.getByTestId('chat-id').textContent).toBe('none');
  expect(screen.queryByText('Select a link to read')).toBeNull();
});

it('opens the chat named by ?chat=', () => {
  setup({ path: '/?chat=c9' });
  expect(screen.getByTestId('chat-id').textContent).toBe('c9');
});

it('treats ?chat=new as a new chat', () => {
  setup({ path: '/?chat=new' });
  expect(screen.getByTestId('chat-id').textContent).toBe('none');
});

it('lets an open link win over ?chat=', () => {
  setup({ path: '/?link=a&chat=c9' });
  expect(screen.queryByTestId('chat-id')).toBeNull();
  expect(screen.getByRole('region', { name: 'Link reader' })).toBeDefined();
});

it('clears ?chat when a link opens and shows the chat again when the reader closes', () => {
  setup({ path: '/?chat=c9&q=x' });
  fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
  expect(screen.getByTestId('where').textContent).toBe('?q=x&link=a');
  expect(screen.queryByTestId('chat-id')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close reader' }));
  expect(screen.getByTestId('where').textContent).toBe('?q=x');
  expect(screen.getByTestId('chat-id').textContent).toBe('none');
});

it('keeps the empty reader while the Librarian is off', () => {
  ready = false;
  setup({ path: '/?chat=c9' });
  expect(screen.queryByTestId('chat-id')).toBeNull();
  expect(screen.getByText('Select a link to read')).toBeDefined();
});

it('keeps the empty reader in Trash', () => {
  setup({ trashed: true });
  expect(screen.queryByTestId('chat-id')).toBeNull();
  expect(screen.getByText('Select a link to read')).toBeDefined();
});

it('does not open the chat by itself where the pane covers the list', () => {
  setup({ narrow: true });
  expect(screen.queryByTestId('chat-id')).toBeNull();
  expect(pane()?.getAttribute('data-reader')).toBe('false');
});

it('opens an explicit ?chat= over the list on a narrow window, and Back or Escape returns', () => {
  setup({ path: '/?chat=c9', narrow: true });
  expect(screen.getByTestId('chat-id').textContent).toBe('c9');
  expect(pane()?.getAttribute('data-reader')).toBe('true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByTestId('where').textContent).toBe('');
  expect(screen.queryByTestId('chat-id')).toBeNull();
});

it('Back clears ?chat, and a created chat replaces ?chat', () => {
  setup({ path: '/?chat=c9&q=x' });
  fireEvent.click(screen.getByRole('button', { name: 'Created' }));
  expect(screen.getByTestId('where').textContent).toBe('?chat=made&q=x');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByTestId('where').textContent).toBe('?q=x');
});
