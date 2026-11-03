import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from '../SettingsContext';
import { SettingsModal } from '../SettingsModal';

const gate = vi.hoisted(() => ({ ready: false, promise: Promise.resolve(), resolve: () => {} }));
vi.mock('./PluginsTab', async (importOriginal) => {
  const { PluginsTab } = await importOriginal<typeof import('./PluginsTab')>();
  return {
    PluginsTab: (props: Parameters<typeof PluginsTab>[0]) => {
      if (!gate.ready) throw gate.promise;
      return <PluginsTab {...props} />;
    },
  };
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

function setup() {
  gate.ready = false;
  gate.promise = new Promise<void>((resolve) => {
    gate.resolve = () => {
      gate.ready = true;
      resolve();
    };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/api/ai')
        ? json({
            status: { enabled: true, secretKey: 'ok', features: {} },
            providers: [],
            features: [{ id: 'x-post-title', label: 'AI titles', plugin: 'twitter' }],
          })
        : json({
            ai: { enabled: true, features: {} },
            plugins: {
              hacker_news: { enabled: true },
              github: { enabled: true },
              youtube: { enabled: true },
              twitter: { enabled: false },
            },
          }),
    ),
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
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps focus on Plugins during a slow load, then moves it to Twitter / X', async () => {
  setup();
  const hint = await screen.findByRole('button', { name: 'Turn on in Plugins > Twitter / X' });
  hint.focus();
  vi.useFakeTimers();
  fireEvent.click(hint);
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Plugins' }));
  await act(async () => {
    vi.advanceTimersByTime(2500);
  });
  await act(async () => {
    gate.resolve();
  });
  vi.useRealTimers();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Twitter / X' })),
  );
});

it.each(['tab change', 'dismissal'])('cancels the focus request on %s', async (cancel) => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on in Plugins > Twitter / X' }));
  if (cancel === 'tab change') {
    fireEvent.click(screen.getByRole('tab', { name: /^AI$/ }));
  } else {
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  }
  await screen.findByRole('button', { name: 'Turn on in Plugins > Twitter / X' });
  const tab = screen.getByRole('tab', { name: 'Plugins' });
  tab.focus();
  fireEvent.click(tab);
  await act(async () => {
    gate.resolve();
  });
  await screen.findByRole('button', { name: 'Twitter / X' });
  expect(document.activeElement).toBe(tab);
});
