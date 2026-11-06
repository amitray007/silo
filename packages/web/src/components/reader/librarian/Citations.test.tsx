import type { UIMessage } from '@ai-sdk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMessage } from './ChatMessage';
import { citedIds } from './SourcesRow';

vi.mock('../listen/voiceModels', () => ({ useVoiceModel: () => ({ phase: 'absent' }) }));

afterEach(() => vi.unstubAllGlobals());

const ONE = '00000000-0000-4000-8000-000000000001';
const TWO = '00000000-0000-4000-8000-000000000002';
const FAKE = '00000000-0000-4000-8000-0000000000ff';

function stubLinks() {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(FAKE)) return new Response('{}', { status: 404 });
    const id = url.includes(ONE) ? 1 : 2;
    return new Response(
      JSON.stringify({
        link: {
          url: `https://site${id}.com/post`,
          title: `Title ${id}`,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

const reply = (text: string, streaming = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <div className="silo-chat-messages">
          <ChatMessage
            streaming={streaming}
            message={
              {
                id: 'a',
                role: 'assistant',
                parts: [{ type: 'text', text }],
              } as unknown as UIMessage
            }
          />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  );

it('renders a saved citation as a pill that opens it in Silo, and drops a made-up id', async () => {
  stubLinks();
  reply(`[One](/?link=${ONE}) and [Ghost](/?link=${FAKE})`);
  const pill = await screen.findByRole('link', { name: 'One' });
  expect(pill.getAttribute('href')).toBe(`/?link=${ONE}`);
  expect(pill.textContent).toBe('One');
  await waitFor(() => expect(screen.queryByRole('link', { name: /Ghost/ })).toBeNull());
  expect(screen.getByText(/Ghost/)).toBeTruthy();
});

it('opens a card on hover and focus with site, saved date and title, and Escape closes it', async () => {
  const fetcher = stubLinks();
  reply(`[One](/?link=${ONE})`);
  const pill = await screen.findByRole('link', { name: 'One' });
  await waitFor(() => expect(pill.querySelector('img')).toBeTruthy());
  fireEvent.mouseEnter(pill);
  const card = screen.getByRole('tooltip');
  expect(card.parentElement).toBe(document.body);
  expect(card.closest('.silo-chat-messages')).toBeNull();
  expect(card.textContent).toContain('site1.com');
  expect(card.textContent).toContain('Saved');
  expect(card.textContent).toContain('Title 1');
  expect(pill.getAttribute('aria-describedby')).toBe(card.id);
  fireEvent.keyDown(pill, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseLeave(pill);
  fireEvent.focus(pill);
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.blur(pill);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes(ONE))).toHaveLength(1);
});

it('shows an external citation as a pill with its link text in a new tab', async () => {
  stubLinks();
  reply('[Web](https://www.example.com/a)');
  const pill = await screen.findByRole('link', { name: 'Web' });
  expect(pill.getAttribute('target')).toBe('_blank');
  expect(pill.getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.mouseEnter(pill);
  expect(screen.getByRole('tooltip').textContent).toContain('example.com');
});

it('lists only the cited links under a finished answer in a Sources menu', async () => {
  stubLinks();
  reply(`See [One](/?link=${ONE}), [One again](/?link=${ONE}) and [Two](/?link=${TWO}).`);
  const toggle = await screen.findByRole('button', { name: '2 sources' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const items = screen.getAllByRole('menuitem');
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toContain('Title 1');
  expect(items[0]?.textContent).toContain('site1.com');
  expect(items[0]?.getAttribute('href')).toBe(`/?link=${ONE}`);
});

it('shows no sources while streaming, with no citations, or for made-up ids only', async () => {
  stubLinks();
  const streaming = reply(`[One](/?link=${ONE})`, true);
  await screen.findByRole('link', { name: 'One' });
  expect(screen.queryByRole('button', { name: /source/ })).toBeNull();
  streaming.unmount();
  reply('No links here.');
  expect(screen.queryByRole('button', { name: /source/ })).toBeNull();
  reply(`[Ghost](/?link=${FAKE})`);
  await waitFor(() => expect(screen.getByText(/Ghost/)).toBeTruthy());
  expect(screen.queryByRole('button', { name: /source/ })).toBeNull();
});

it('reads cited saved ids from the markdown, once each', () => {
  expect(
    citedIds(`[a](/?link=${ONE}) [b](/?link=${ONE.toUpperCase()}) [c](https://x.com)`),
  ).toEqual([ONE]);
});

it('falls back to the short site name for a bare URL or the domain as link text', async () => {
  stubLinks();
  reply(
    '[https://www.example.com/a](https://www.example.com/a) [example.com](https://example.com/b)',
  );
  const pills = await screen.findAllByRole('link');
  expect(pills.map((pill) => pill.textContent)).toEqual(['example', 'example']);
});

it('keeps the card open while the pointer moves onto it, then closes it', async () => {
  stubLinks();
  reply(`[One](/?link=${ONE})`);
  const pill = await screen.findByRole('link', { name: 'One' });
  vi.useFakeTimers();
  fireEvent.mouseEnter(pill);
  fireEvent.mouseLeave(pill);
  fireEvent.mouseEnter(screen.getByRole('tooltip'));
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.mouseLeave(screen.getByRole('tooltip'));
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole('tooltip')).toBeNull();
  vi.useRealTimers();
});

it('closes the card when the page scrolls', async () => {
  stubLinks();
  reply(`[One](/?link=${ONE})`);
  fireEvent.focus(await screen.findByRole('link', { name: 'One' }));
  fireEvent.scroll(window);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('lists the real link in Sources when a made-up id was matched to a cited item by title', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(FAKE)) return new Response('{}', { status: 404 });
      return new Response(
        JSON.stringify({
          link: {
            url: 'https://site1.com/post',
            title: 'Real title',
            createdAt: '2026-10-01T00:00:00.000Z',
          },
        }),
      );
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ChatMessage
          message={
            {
              id: 'a',
              role: 'assistant',
              parts: [
                {
                  type: 'dynamic-tool',
                  toolName: 'search_links',
                  toolCallId: 's',
                  state: 'output-available',
                  input: {},
                  output: { results: [{ id: ONE, title: 'Real title' }] },
                },
                { type: 'text', text: `See [Real title](/?link=${FAKE}).` },
              ],
            } as unknown as UIMessage
          }
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('button', { name: '1 source' })).toBeTruthy();
});

it('stacks one favicon per site but counts every link', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            link: { url: 'https://site1.com/x', title: 'T', createdAt: '2026-10-01T00:00:00.000Z' },
          }),
        ),
    ),
  );
  reply(`[A](/?link=${ONE}) [B](/?link=${TWO})`);
  const toggle = await screen.findByRole('button', { name: '2 sources' });
  expect(toggle.querySelectorAll('.silo-letter-chip')).toHaveLength(1);
});
