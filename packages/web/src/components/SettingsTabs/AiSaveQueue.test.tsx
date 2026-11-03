import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from '../SettingsContext';
import { SettingsModal } from '../SettingsModal';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const model = { provider: 'anthropic', id: 'haiku' };
function setup() {
  let stored = {
    ai: {
      enabled: true,
      features: {
        'x-post-title': { enabled: false, model: null as typeof model | null },
        librarian: { enabled: false, model: null as typeof model | null },
      },
    },
    plugins: {
      hacker_news: { enabled: true },
      github: { enabled: true },
      youtube: { enabled: true },
      twitter: { enabled: true },
    },
  };
  const writes: { body: typeof stored; finish: (fail?: boolean) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as typeof stored;
        return new Promise<Response>((resolve) =>
          writes.push({
            body,
            finish: (fail) => {
              if (!fail) stored = { ...stored, ...body };
              resolve(
                fail ? json({ error: 'unavailable', message: 'Save failed' }, 503) : json(stored),
              );
            },
          }),
        );
      }
      return String(input).endsWith('/api/ai')
        ? json({
            status: { enabled: true, secretKey: 'ok', features: {} },
            providers: [
              {
                kind: 'anthropic',
                configured: true,
                keyReadable: true,
                defaultModel: 'haiku',
                models: [],
              },
            ],
            features: [
              { id: 'x-post-title', label: 'AI titles', plugin: 'twitter' },
              { id: 'librarian', label: 'Librarian' },
            ],
          })
        : json(stored);
    }),
  );
  function Harness() {
    const { open, openSettings } = useSettings();
    return (
      <>
        <button type="button" onClick={() => openSettings('ai')}>
          Open AI
        </button>
        {open && <SettingsModal />}
      </>
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsProvider>
          <Harness />
        </SettingsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  return { writes, stored: () => stored };
}
async function plugins() {
  fireEvent.click(screen.getByRole('tab', { name: 'Plugins' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Twitter / X' }));
  return screen.findByRole('switch', { name: 'AI titles' });
}
async function finish(write: { finish: (fail?: boolean) => void } | undefined, fail = false) {
  expect(write).toBeDefined();
  await act(async () => {
    write?.finish(fail);
  });
}
afterEach(() => vi.unstubAllGlobals());

it('keeps the last AI titles choice when saves come from different tabs', async () => {
  const server = setup();
  fireEvent.click(await screen.findByRole('switch', { name: 'AI titles' }));
  await waitFor(() => expect(server.writes).toHaveLength(1));
  const toggle = await plugins();
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  // The first response must neither revert the visible choice nor race the next write.
  expect(server.writes).toHaveLength(1);
  await finish(server.writes[0]);
  await waitFor(() => expect(server.writes).toHaveLength(2));
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await finish(server.writes[1]);
  await waitFor(() => expect(toggle).toHaveProperty('disabled', false));
  expect(server.stored().ai.features['x-post-title'].enabled).toBe(false);
});

it('drops a failed change between successes and rolls back a final failure', async () => {
  const server = setup();
  fireEvent.click(await screen.findByRole('switch', { name: 'AI titles' }));
  await waitFor(() => expect(server.writes).toHaveLength(1));
  const title = await plugins();
  fireEvent.click(title);
  await waitFor(() => expect(title.getAttribute('aria-checked')).toBe('false'));
  fireEvent.click(screen.getByRole('tab', { name: /^AI$/ }));
  fireEvent.click(await screen.findByRole('switch', { name: 'Librarian' }));
  await finish(server.writes[0]);
  await waitFor(() => expect(server.writes).toHaveLength(2));
  await finish(server.writes[1], true);
  await waitFor(() => expect(server.writes).toHaveLength(3));
  expect(server.writes[2]?.body.ai.features['x-post-title'].enabled).toBe(true);
  await finish(server.writes[2]);
  expect(server.stored().ai.features.librarian.enabled).toBe(true);
  expect(screen.getByRole('switch', { name: 'AI titles' }).getAttribute('aria-checked')).toBe(
    'true',
  );
  const finalToggle = await plugins();
  fireEvent.click(finalToggle);
  await waitFor(() => expect(server.writes).toHaveLength(4));
  await finish(server.writes[3], true);
  await waitFor(() => expect(finalToggle.getAttribute('aria-checked')).toBe('true'));
  expect((await screen.findByRole('alert')).textContent).toBe('Save failed');
});
