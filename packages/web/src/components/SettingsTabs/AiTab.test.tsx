import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModalShell } from '../ModalShell';
import { AiTab } from './AiTab';

const TEST_KEY = 'sk-test-0123456789abcdef';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? {} : { 'content-type': 'application/json' },
  });
}

function settingsFixture(ai?: Partial<{ enabled: boolean; provider: string | null }>) {
  return {
    theme: 'system',
    trashPurgeDays: 30,
    mcpAccess: true,
    linkPreviewImages: true,
    hoverPreview: false,
    plugins: {},
    ai: {
      enabled: ai?.enabled ?? true,
      features: {
        'x-post-title': {
          enabled: false,
          model: ai?.provider ? { provider: ai.provider, id: 'claude-haiku-5-5' } : null,
        },
      },
    },
  };
}

type Provider = {
  kind: string;
  configured: boolean;
  keyLast4: string | null;
  keyReadable: boolean;
  lastTest: { ok: boolean; at: string; code?: string } | null;
  models: { id: string; label: string; contextLength: number | null }[];
  modelsFetchedAt: string | null;
  modelsRefreshError: string | null;
};

function aiFixture(opts: {
  secretKey?: 'ok' | 'missing' | 'invalid';
  provider?: string | null;
  model?: string | null;
  providers?: Partial<Provider>[];
}) {
  const kinds = ['anthropic', 'openai', 'gateway', 'fireworks'];
  const providers = kinds.map((kind) => ({
    kind,
    configured: false,
    keyLast4: null,
    keyReadable: true,
    lastTest: null,
    models:
      kind === 'anthropic'
        ? [{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }]
        : kind === 'openai'
          ? [{ id: 'gpt-5-mini', label: 'GPT-5 mini' }]
          : kind === 'gateway'
            ? [
                { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
                { id: 'gpt-5-mini', label: 'GPT-5 mini' },
              ]
            : [],
    defaultModel:
      kind === 'anthropic'
        ? 'claude-haiku-5-5'
        : kind === 'fireworks'
          ? 'accounts/fireworks/models/glm-5p3-flash'
          : 'gpt-5-mini',
    modelsFetchedAt: null,
    ...opts.providers?.find((p) => p.kind === kind),
  }));
  return {
    status: {
      enabled: true,
      secretKey: opts.secretKey ?? 'ok',
      features: {
        'x-post-title': {
          ready: false,
          reason: 'feature_disabled',
          provider: opts.provider ?? null,
          model: opts.model ?? null,
        },
      },
    },
    providers,
    features: [
      { id: 'x-post-title', label: 'AI titles', description: 'Short titles', plugin: 'twitter' },
    ],
  };
}

function setup(opts: {
  ai?: ReturnType<typeof aiFixture>;
  settings?: ReturnType<typeof settingsFixture>;
  putResponse?: Response;
  inSettings?: boolean;
  /** Overrides the provider route (PUT/POST test/DELETE); may return a pending promise. */
  providerRoute?: (method: string) => Response | Promise<Response> | undefined;
}) {
  let settings = opts.settings ?? settingsFixture();
  const ai = opts.ai ?? aiFixture({});
  const calls: { method: string; url: string; body: unknown }[] = [];
  const providerResponse = (method: string): Response => {
    if (method === 'PUT') {
      return opts.putResponse ?? jsonResponse({ provider: null, test: { ok: true } });
    }
    return method === 'DELETE' ? jsonResponse(null, 204) : jsonResponse({ ok: true });
  };
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (method !== 'GET') calls.push({ method, url, body });
    if (url.includes('/api/ai/providers')) {
      return Promise.resolve(opts.providerRoute?.(method) ?? providerResponse(method));
    }
    if (url.includes('/api/ai')) return Promise.resolve(jsonResponse(ai));
    if (method === 'PATCH') settings = { ...settings, ...body };
    return Promise.resolve(jsonResponse(settings));
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {opts.inSettings ? <SettingsHarness /> : <AiTab />}
    </QueryClientProvider>,
  );
  return { calls };
}

function SettingsHarness() {
  const [open, setOpen] = useState(true);
  return open ? (
    <ModalShell width={800} ariaLabel="Settings" onClose={() => setOpen(false)}>
      <AiTab />
    </ModalShell>
  ) : null;
}

async function menuAction(provider: string, action: string) {
  fireEvent.click(await screen.findByRole('button', { name: `More actions for ${provider}` }));
  const menu = screen.getByRole('menu', { name: `More actions for ${provider}` });
  fireEvent.click(within(menu).getByRole('menuitem', { name: action }));
}

afterEach(() => vi.unstubAllGlobals());

const NOW = new Date().toISOString();
const ANTHROPIC_OK = {
  kind: 'anthropic',
  configured: true,
  keyLast4: 'abcd',
  keyReadable: true,
  lastTest: { ok: true, at: NOW },
};

describe('AiTab', () => {
  it('shows the secret key callout in place of provider and model sections', async () => {
    setup({ ai: aiFixture({ secretKey: 'missing' }) });
    expect(await screen.findByText(/Set SILO_SECRET_KEY on the server/)).toBeTruthy();
    expect(screen.getByText('openssl rand -base64 32')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByLabelText('AI titles model')).toBeNull();
  });

  it('explains an invalid secret key', async () => {
    setup({ ai: aiFixture({ secretKey: 'invalid' }) });
    expect(await screen.findByText(/is not 32 bytes of base64/)).toBeTruthy();
  });

  it('dims and disables provider controls while AI is off', async () => {
    setup({
      settings: settingsFixture({ enabled: false }),
      ai: aiFixture({ providers: [ANTHROPIC_OK] }),
    });
    const add = await screen.findByRole('button', { name: 'More actions for Anthropic' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'AI titles model' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'AI titles model' }).textContent).toContain(
      'Choose a model',
    );
  });

  it('PATCHes ai.enabled from the master switch', async () => {
    const { calls } = setup({ settings: settingsFixture({ enabled: false }) });
    const toggle = await screen.findByRole('switch', { name: 'Use AI' });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          body: { ai: expect.objectContaining({ enabled: true }) },
        }),
      ),
    );
  });

  it('saves a key, clears the field and keeps the key out of the DOM', async () => {
    const { calls } = setup({});
    fireEvent.click(await screen.findByRole('button', { name: 'Add Anthropic key' }));
    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('new-password');
    fireEvent.change(input, { target: { value: TEST_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          url: '/api/ai/providers/anthropic',
          body: { apiKey: TEST_KEY },
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText('Anthropic API key')).toBeNull());
    expect(document.body.innerHTML).not.toContain(TEST_KEY);
  });

  it('shows the server message inline when saving fails', async () => {
    setup({
      putResponse: jsonResponse(
        {
          error: 'secret_key_missing',
          message: 'Set SILO_SECRET_KEY on the server to store keys.',
        },
        409,
      ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add OpenAI key' }));
    const input = screen.getByLabelText('OpenAI API key');
    fireEvent.change(input, { target: { value: TEST_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('SILO_SECRET_KEY');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('shows the operator-only message when the switch is refused', async () => {
    setup({ settings: settingsFixture({ enabled: false }) });
    const toggle = await screen.findByRole('switch', { name: 'Use AI' });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) =>
      init?.method === 'PATCH'
        ? Promise.resolve(
            jsonResponse(
              { error: 'operator_only', message: 'Only the owner can change AI settings.' },
              403,
            ),
          )
        : (original as typeof fetch)(input, init),
    );
    fireEvent.click(toggle);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only the owner can change AI settings.',
    );
  });

  it('renders status lines for set, tested and rejected keys', async () => {
    setup({
      ai: aiFixture({
        providers: [
          ANTHROPIC_OK,
          {
            kind: 'openai',
            configured: true,
            keyLast4: 'wxyz',
            lastTest: { ok: false, at: NOW, code: 'invalid_key' },
          },
          {
            kind: 'gateway',
            configured: true,
            keyLast4: '1234',
            lastTest: { ok: false, at: NOW, code: 'rate_limited' },
          },
        ],
      }),
    });
    const key = await screen.findByText('••••abcd');
    expect(key.closest('[role="status"]')?.textContent).toBe(
      '••••abcd · 1 models · tested just now',
    );
    expect(screen.getByText('Key rejected')).toBeTruthy();
    expect(screen.getByText('Rate limited').closest('[role="status"]')?.textContent).toBe(
      '••••1234 · 2 models · Rate limited',
    );
  });

  it('keeps the masked key, model count and test age on one meta line', async () => {
    const now = new Date('2026-10-29T12:00:00Z').getTime();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      setup({
        ai: aiFixture({
          providers: [
            {
              ...ANTHROPIC_OK,
              keyLast4: 'fwAA',
              lastTest: { ok: true, at: new Date(now - 5 * 60 * 60_000).toISOString() },
              models: Array.from({ length: 14 }, (_, i) => ({
                id: `model-${i}`,
                label: `Model ${i}`,
                contextLength: null,
              })),
              modelsFetchedAt: new Date(now - 15 * 60_000).toISOString(),
            },
          ],
        }),
      });
      const key = await screen.findByText('••••fwAA');
      const row = key.closest('.silo-ai-provider-row');
      expect(row?.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(key.closest('[role="status"]')?.textContent).toBe(
        '••••fwAA · 14 models · tested 5 h ago',
      );
      expect(screen.getByText('14 models').title).toBe('14 models · updated 15 min ago');
      expect(screen.queryByText('updated 15 min ago')).toBeNull();
      expect(screen.getAllByText('Not set')).toHaveLength(3);
      expect(screen.queryByRole('menuitem')).toBeNull();
      expect(
        within(row as HTMLElement)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Test', '']);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    ['invalid_key', 'Key rejected'],
    ['no_access', 'Key rejected'],
    ['model_not_found', 'Model not found'],
    ['rate_limited', 'Rate limited'],
    ['timeout', 'Timed out'],
    ['network', 'Network error'],
    ['provider_error', 'Provider error'],
    ['quota', 'Out of credit or over the limit'],
    ['unavailable', 'Test unavailable right now'],
  ])('renders the saved %s error in the affected meta segment', async (code, words) => {
    setup({
      ai: aiFixture({
        providers: [
          {
            ...ANTHROPIC_OK,
            lastTest: { ok: false, at: NOW, code },
          },
        ],
      }),
    });
    const error = await screen.findByRole('alert');
    expect(error.textContent).toBe(words);
    expect(error.className).toBe('silo-ai-provider-warning');
    const meta = error.closest('.silo-ai-provider-meta');
    expect(meta).toBeTruthy();
    expect(meta?.textContent).toContain('1 models');
    if (words === 'Key rejected') expect(meta?.textContent).not.toContain('••••abcd');
    else expect(meta?.textContent).toContain('••••abcd');
  });

  it('keeps the fallback copy for a saved failed test without an error code', async () => {
    setup({
      ai: aiFixture({
        providers: [
          {
            ...ANTHROPIC_OK,
            lastTest: { ok: false, at: NOW },
          },
        ],
      }),
    });
    const error = await screen.findByRole('alert');
    expect(error.textContent).toBe('Test failed');
    expect(error.closest('.silo-ai-provider-meta')).toBeTruthy();
  });

  it('opens the shared menu with arrow keys and restores focus without dismissing Settings', async () => {
    setup({ ai: aiFixture({ providers: [ANTHROPIC_OK] }), inSettings: true });
    const trigger = await screen.findByRole('button', { name: 'More actions for Anthropic' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu', { name: 'More actions for Anthropic' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: 'Replace key' }),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: 'Refresh models' }),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: 'Replace key' }),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Remove key' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('opens Replace key from the menu and returns focus after cancelling the inline field', async () => {
    setup({ ai: aiFixture({ providers: [ANTHROPIC_OK] }) });
    await menuAction('Anthropic', 'Replace key');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Anthropic API key'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Anthropic API key')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'More actions for Anthropic' }),
    );
  });

  it('cancels removal without deleting the key', async () => {
    const { calls } = setup({ ai: aiFixture({ providers: [ANTHROPIC_OK] }) });
    await menuAction('Anthropic', 'Remove key');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('alertdialog', { name: 'Remove Anthropic key?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('removes a key only after the second step', async () => {
    const { calls } = setup({ ai: aiFixture({ providers: [ANTHROPIC_OK] }) });
    await menuAction('Anthropic', 'Remove key');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove?' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'DELETE', url: '/api/ai/providers/anthropic' }),
      ),
    );
  });

  it('renders four provider marks and no provider radio or global Model section', async () => {
    setup({});
    await screen.findByRole('heading', { name: 'Features' });
    expect(document.querySelectorAll('svg[viewBox="0 0 24 24"]')).toHaveLength(4);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Model' })).toBeNull();
    expect(screen.getByText('X posts')).toBeTruthy();
    expect(screen.getByText('Turn on in Plugins > Twitter / X')).toBeTruthy();
  });

  it('groups models by readable provider with decorative marks and saves provider plus id', async () => {
    const { calls } = setup({
      ai: aiFixture({
        providers: [
          ANTHROPIC_OK,
          { kind: 'gateway', configured: true },
          { kind: 'openai', configured: true, keyReadable: false },
        ],
      }),
    });
    const trigger = await screen.findByRole('button', { name: 'AI titles model' });
    await waitFor(() => expect(trigger).toHaveProperty('disabled', false));
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox');
    expect(
      within(list)
        .getAllByRole('group')
        .map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent),
    ).toEqual(['Anthropic', 'Vercel AI Gateway']);
    expect(within(list).queryByRole('group', { name: 'OpenAI' })).toBeNull();
    expect(within(list).queryByRole('group', { name: 'Fireworks' })).toBeNull();
    const gateway = within(list).getByRole('group', { name: 'Vercel AI Gateway' });
    expect(
      document
        .getElementById(gateway.getAttribute('aria-labelledby') ?? '')
        ?.querySelector('svg[fill="currentColor"]'),
    ).toBeTruthy();
    fireEvent.click(within(gateway).getByRole('option', { name: /GPT-5 mini/ }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          body: {
            ai: expect.objectContaining({
              features: {
                'x-post-title': {
                  enabled: false,
                  model: { provider: 'gateway', id: 'gpt-5-mini' },
                },
              },
            }),
          },
        }),
      ),
    );
  });

  it('keeps group headers out of the options and distinguishes the same model on two providers', async () => {
    setup({
      settings: settingsFixture({ provider: 'anthropic' }),
      ai: aiFixture({ providers: [ANTHROPIC_OK, { kind: 'gateway', configured: true }] }),
    });
    const trigger = await screen.findByRole('button', { name: 'AI titles model' });
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(
      within(list)
        .getAllByRole('option')
        .filter((o) => o.querySelector('[data-current]')),
    ).toHaveLength(1);
    fireEvent.click(within(list).getByText('Anthropic'));
    expect(screen.queryByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows only the Fireworks live list, its age, and saves the full live model id', async () => {
    const { calls } = setup({
      ai: aiFixture({
        providers: [
          {
            kind: 'fireworks',
            configured: true,
            models: [
              {
                id: 'accounts/fireworks/models/custom',
                label: 'Live custom model',
                contextLength: null,
              },
            ],
            modelsFetchedAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(await screen.findByText('1 models')).toHaveProperty(
      'title',
      '1 models · updated just now',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'AI titles model' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('option', { name: /Live custom model/ }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          body: {
            ai: expect.objectContaining({
              features: {
                'x-post-title': {
                  enabled: false,
                  model: { provider: 'fireworks', id: 'accounts/fireworks/models/custom' },
                },
              },
            }),
          },
        }),
      ),
    );
  });

  it('shows the stale-list hint while retaining the stored models and age', async () => {
    setup({
      ai: aiFixture({
        providers: [
          {
            kind: 'fireworks',
            configured: true,
            models: [{ id: 'stored-model', label: 'Stored model', contextLength: null }],
            modelsFetchedAt: NOW,
            modelsRefreshError: 'timeout',
          },
        ],
      }),
    });
    const hint = await screen.findByText("Couldn't refresh the list");
    expect(hint.className).toBe('silo-ai-provider-warning');
    expect(hint).toHaveProperty('title', '1 models · updated just now');
    expect(hint.closest('[role="status"]')?.textContent).toBe(
      "•••• · Couldn't refresh the list · Not tested",
    );
    fireEvent.click(await screen.findByRole('button', { name: 'AI titles model' }));
    expect(screen.getByRole('option', { name: /Stored model/ })).toBeTruthy();
  });

  it('refreshes Fireworks through the operator route and disables that row while pending', async () => {
    let release: (r: Response) => void = () => {};
    const ai = aiFixture({ providers: [{ kind: 'fireworks', configured: true }] });
    const { calls } = setup({
      ai,
      providerRoute: () =>
        new Promise<Response>((r) => {
          release = r;
        }),
    });
    await menuAction('Fireworks', 'Refresh models');
    expect(await screen.findByText('Refreshing…')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    for (const name of ['More actions for Fireworks', 'Test Fireworks key']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
    }
    expect(screen.getByRole('button', { name: 'Add Anthropic key' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/ai/providers/fireworks/models/refresh',
      body: {},
    });
    const fireworks = ai.providers.find((p) => p.kind === 'fireworks');
    if (fireworks)
      fireworks.models = [{ id: 'live', label: 'New live model', contextLength: null }];
    release(jsonResponse({ ok: true, models: fireworks?.models }));
    await screen.findByText('1 models');
    fireEvent.click(screen.getByRole('button', { name: 'AI titles model' }));
    expect(screen.getByRole('option', { name: /New live model/ })).toBeTruthy();
  });

  it('shows the empty Fireworks state and a failed refresh in plain words', async () => {
    setup({
      ai: aiFixture({ providers: [{ kind: 'fireworks', configured: true }] }),
      providerRoute: () =>
        jsonResponse({ error: 'quota', message: 'Could not refresh Fireworks models.' }, 502),
    });
    expect(
      await screen.findByText('No models available. Refresh the list or test the key.'),
    ).toBeTruthy();
    await menuAction('Fireworks', 'Refresh models');
    expect((await screen.findByRole('alert')).textContent).toBe('Out of credit or over the limit');
  });

  it.each([
    ['anthropic', 'Anthropic'],
    ['openai', 'OpenAI'],
    ['gateway', 'Vercel AI Gateway'],
    ['fireworks', 'Fireworks'],
  ])('refreshes %s with its own busy state and stale-list hint', async (kind, name) => {
    let finish: (response: Response) => void = () => {};
    const { calls } = setup({
      ai: aiFixture({
        providers: [
          { kind, configured: true, modelsRefreshError: 'timeout', modelsFetchedAt: NOW },
        ],
      }),
      providerRoute: () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    expect(await screen.findByText("Couldn't refresh the list")).toBeTruthy();
    await menuAction(name, 'Refresh models');
    await screen.findByText('Refreshing…');
    expect(screen.queryByRole('menu')).toBeNull();
    const more = screen.getByRole('button', { name: `More actions for ${name}` });
    expect(more).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: `Test ${name} key` })).toHaveProperty(
      'disabled',
      true,
    );
    const other = kind === 'anthropic' ? 'OpenAI' : 'Anthropic';
    expect(screen.getByRole('button', { name: `Add ${other} key` })).toHaveProperty(
      'disabled',
      false,
    );
    expect(calls).toContainEqual({
      method: 'POST',
      url: `/api/ai/providers/${kind}/models/refresh`,
      body: {},
    });
    finish(jsonResponse({ ok: true }));
    await waitFor(() => expect(more).toHaveProperty('disabled', false));
  });

  it('shows an inline alert when selecting a model fails to PATCH', async () => {
    setup({ ai: aiFixture({ providers: [ANTHROPIC_OK] }) });
    const trigger = await screen.findByRole('button', { name: 'AI titles model' });
    const original = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    vi.mocked(fetch).mockImplementation((input, init) =>
      init?.method === 'PATCH'
        ? Promise.resolve(
            jsonResponse({ error: 'invalid_model', message: 'Model is no longer available.' }, 400),
          )
        : original(input, init),
    );
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /Claude Haiku/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Model is no longer available.');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows a feature readiness reason in plain words', async () => {
    const ai = aiFixture({ providers: [ANTHROPIC_OK] });
    ai.status.features['x-post-title'].reason = 'no_model';
    const settings = settingsFixture();
    settings.ai.features['x-post-title'].enabled = true;
    setup({ ai, settings });
    expect(await screen.findByText('Choose a model.', { selector: 'div' })).toBeTruthy();
  });

  it.each(['Test', 'Replace', 'Remove', 'Refresh'])(
    'clears a failed refresh when %s starts on the same row',
    async (action) => {
      let requests = 0;
      let finish: (response: Response) => void = () => {};
      setup({
        ai: aiFixture({ providers: [{ kind: 'fireworks', configured: true }] }),
        providerRoute: () => {
          requests += 1;
          return requests === 1
            ? jsonResponse({ error: 'quota', message: 'Refresh failed.' }, 502)
            : new Promise<Response>((resolve) => {
                finish = resolve;
              });
        },
      });
      await menuAction('Fireworks', 'Refresh models');
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Out of credit or over the limit',
      );
      if (action === 'Test') {
        fireEvent.click(screen.getByRole('button', { name: 'Test Fireworks key' }));
      } else {
        await menuAction('Fireworks', action === 'Refresh' ? 'Refresh models' : `${action} key`);
      }
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      if (action === 'Test' || action === 'Refresh') {
        finish(jsonResponse({ ok: true }));
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'Test Fireworks key' })).toHaveProperty(
            'disabled',
            false,
          ),
        );
        expect(screen.queryByRole('alert')).toBeNull();
      } else if (action === 'Replace') {
        fireEvent.change(screen.getByLabelText('Fireworks API key'), {
          target: { value: TEST_KEY },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save & test' }));
        await waitFor(() => expect(requests).toBe(2));
        finish(jsonResponse({ provider: null, test: { ok: true } }));
        await waitFor(() => expect(screen.queryByLabelText('Fireworks API key')).toBeNull());
        expect(screen.queryByRole('alert')).toBeNull();
      }
    },
  );

  it('clears a failed Test result when Refresh starts', async () => {
    let requests = 0;
    setup({
      ai: aiFixture({ providers: [{ kind: 'fireworks', configured: true }] }),
      providerRoute: () => {
        requests += 1;
        return jsonResponse(requests === 1 ? { ok: false, code: 'network' } : { ok: true });
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Test Fireworks key' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Network error');
    await menuAction('Fireworks', 'Refresh models');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('clears a refresh error on key submission when the replacement form is already open', async () => {
    let finish: (response: Response) => void = () => {};
    const { calls } = setup({
      ai: aiFixture({ providers: [{ kind: 'fireworks', configured: true }] }),
      providerRoute: (method) =>
        method === 'POST'
          ? jsonResponse({ error: 'quota', message: 'Refresh failed.' }, 502)
          : new Promise<Response>((resolve) => {
              finish = resolve;
            }),
    });
    await menuAction('Fireworks', 'Replace key');
    await menuAction('Fireworks', 'Refresh models');
    expect((await screen.findByRole('alert')).textContent).toBe('Out of credit or over the limit');
    fireEvent.change(screen.getByLabelText('Fireworks API key'), { target: { value: TEST_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();
    finish(jsonResponse({ provider: null, test: { ok: true } }));
    await waitFor(() => expect(screen.queryByLabelText('Fireworks API key')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables the row and shows Testing… while a Test is pending, then refreshes', async () => {
    let release: (r: Response) => void = () => {};
    const { calls } = setup({
      ai: aiFixture({ providers: [ANTHROPIC_OK] }),
      providerRoute: (m) =>
        m === 'POST'
          ? new Promise<Response>((r) => {
              release = r;
            })
          : undefined,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Test Anthropic key' }));
    const testing = await screen.findByRole('button', { name: 'Test Anthropic key' });
    expect(testing.textContent).toBe('Testing…');
    expect((testing as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'More actions for Anthropic' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'POST', url: '/api/ai/providers/anthropic/test' }),
    );
    release(jsonResponse({ ok: true }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Test Anthropic key' }).textContent).toBe('Test'),
    );
  });

  it('shows a failed Test in plain words', async () => {
    setup({
      ai: aiFixture({ providers: [ANTHROPIC_OK] }),
      providerRoute: (m) =>
        m === 'POST' ? jsonResponse({ ok: false, code: 'unavailable' }) : undefined,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Test Anthropic key' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Test unavailable right now');
  });

  it.each([
    ['quota', 'Out of credit or over the limit'],
    ['invalid_key', 'Key rejected'],
    ['no_access', 'Key rejected'],
    ['model_not_found', 'Model not found'],
    ['rate_limited', 'Rate limited'],
    ['timeout', 'Timed out'],
    ['network', 'Network error'],
    ['provider_error', 'Provider error'],
  ])('shows %s in plain words', async (code, words) => {
    setup({
      ai: aiFixture({ providers: [ANTHROPIC_OK] }),
      providerRoute: () => jsonResponse({ ok: false, code }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Test Anthropic key' }));
    const error = await screen.findByRole('alert');
    expect(error.textContent).toBe(words);
    expect(error.closest('.silo-ai-provider-meta')).toBeTruthy();
    expect(error.className).toBe('silo-ai-provider-warning');
  });

  it('shows the error when the Test request fails', async () => {
    setup({
      ai: aiFixture({ providers: [ANTHROPIC_OK] }),
      providerRoute: (m) =>
        m === 'POST'
          ? jsonResponse({ error: 'operator_only', message: 'Only the owner can do this.' }, 403)
          : undefined,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Test Anthropic key' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only the owner can do this.');
  });

  it('keeps the remove confirm open and shows the error when Remove fails', async () => {
    setup({
      ai: aiFixture({ providers: [ANTHROPIC_OK] }),
      providerRoute: (m) =>
        m === 'DELETE'
          ? jsonResponse({ error: 'boom', message: 'Could not remove the key.' }, 500)
          : undefined,
    });
    await menuAction('Anthropic', 'Remove key');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove?' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not remove the key.');
    expect(screen.getByRole('button', { name: 'Confirm remove?' })).toBeTruthy();
  });

  it('keeps the key out of the DOM while the PUT is pending and disables the row', async () => {
    let release: (r: Response) => void = () => {};
    setup({
      ai: aiFixture({ providers: [ANTHROPIC_OK] }),
      providerRoute: (m) =>
        m === 'PUT'
          ? new Promise<Response>((r) => {
              release = r;
            })
          : undefined,
    });
    await menuAction('Anthropic', 'Replace key');
    fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: TEST_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }));
    await screen.findByText('Testing…', { selector: 'button' });
    expect(screen.queryByDisplayValue(TEST_KEY)).toBeNull();
    expect(document.body.innerHTML).not.toContain(TEST_KEY);
    expect(
      (screen.getByRole('button', { name: 'More actions for Anthropic' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole('radio')).toBeNull();
    release(jsonResponse({ provider: null, test: { ok: true } }));
    await waitFor(() => expect(screen.queryByLabelText('Anthropic API key')).toBeNull());
  });

  it('shows the 400 message and no key text after an error response', async () => {
    setup({
      putResponse: jsonResponse(
        { error: 'invalid_api_key', message: 'API key must be 8-300 printable ASCII characters.' },
        400,
      ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Anthropic key' }));
    fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: TEST_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }));
    expect((await screen.findByRole('alert')).textContent).toContain('printable ASCII');
    expect(screen.queryByDisplayValue(TEST_KEY)).toBeNull();
    expect(document.body.innerHTML).not.toContain(TEST_KEY);
  });

  it('closes the form on a saved key that the provider rejects and shows Key rejected', async () => {
    const rejected = {
      kind: 'anthropic',
      configured: true,
      keyLast4: 'cdef',
      lastTest: { ok: false, at: NOW, code: 'invalid_key' },
    };
    setup({
      ai: aiFixture({ providers: [rejected] }),
      putResponse: jsonResponse({ provider: rejected, test: { ok: false, code: 'invalid_key' } }),
    });
    await menuAction('Anthropic', 'Replace key');
    fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: TEST_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }));
    await waitFor(() => expect(screen.queryByLabelText('Anthropic API key')).toBeNull());
    expect(screen.getByText('Key rejected')).toBeTruthy();
  });

  it('says when a stored key cannot be read, and blocks picking it', async () => {
    setup({
      ai: aiFixture({
        providers: [{ ...ANTHROPIC_OK, keyReadable: false }],
      }),
    });
    const error = await screen.findByText("Key can't be read");
    expect(error.closest('.silo-ai-provider-meta')).toBeTruthy();
    expect(error.className).toBe('silo-ai-provider-warning');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Anthropic' }));
    expect(screen.getByRole('menuitem', { name: 'Refresh models' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows an error when AI settings fail to load', async () => {
    setup({});
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'boom', message: 'Server down' }, 500)),
    );
    cleanup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AiTab />
      </QueryClientProvider>,
    );
    expect((await screen.findByText(/Could not load AI settings/)).textContent).toContain(
      'Server down',
    );
  });
});
