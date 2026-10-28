import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const CATALOG = [
  {
    id: 'claude-haiku-5-5',
    family: 'claude',
    label: 'Claude Haiku 5.5',
    tier: 'fast',
    providers: ['anthropic', 'gateway'],
    defaultFor: ['anthropic'],
  },
  {
    id: 'gpt-5-mini',
    family: 'chatgpt',
    label: 'GPT-5 mini',
    tier: 'balanced',
    providers: ['openai', 'gateway'],
    defaultFor: ['openai'],
  },
];

type Provider = {
  kind: string;
  configured: boolean;
  keyLast4: string | null;
  keyReadable: boolean;
  lastTest: { ok: boolean; at: string; code?: string } | null;
  models: { id: string; label: string; contextLength: number | null }[];
  modelsFetchedAt: string | null;
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
    models: [],
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
    catalog: CATALOG,
    features: [
      { id: 'x-post-title', label: 'AI titles', description: 'Short titles', plugin: 'twitter' },
    ],
  };
}

function setup(opts: {
  ai?: ReturnType<typeof aiFixture>;
  settings?: ReturnType<typeof settingsFixture>;
  putResponse?: Response;
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
      <AiTab />
    </QueryClientProvider>,
  );
  return { calls };
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
    const add = await screen.findByRole('button', { name: 'Replace Anthropic key' });
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
    expect(await screen.findByText('Key ••••abcd · Tested just now')).toBeTruthy();
    expect(screen.getByText('Key rejected')).toBeTruthy();
    expect(screen.getByText('Key ••••1234 · Rate limited')).toBeTruthy();
  });

  it('removes a key only after the second step', async () => {
    const { calls } = setup({ ai: aiFixture({ providers: [ANTHROPIC_OK] }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Anthropic key' }));
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
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Anthropic', 'Vercel AI Gateway']);
    expect(within(list).queryByRole('group', { name: 'OpenAI' })).toBeNull();
    expect(within(list).queryByRole('group', { name: 'Fireworks' })).toBeNull();
    const gateway = within(list).getByRole('group', { name: 'Vercel AI Gateway' });
    expect(gateway.querySelector('svg[fill="currentColor"]')).toBeTruthy();
    fireEvent.click(within(gateway).getByRole('option', { name: 'GPT-5 mini - balanced' }));
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
        .filter((o) => o.getAttribute('aria-selected') === 'true'),
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
    expect(await screen.findByText('1 models · updated just now')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'AI titles model' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('option', { name: 'Live custom model' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh Fireworks models' }));
    expect(await screen.findByText('Refreshing models…')).toBeTruthy();
    for (const name of [
      'Refresh Fireworks models',
      'Replace Fireworks key',
      'Test Fireworks key',
      'Remove Fireworks key',
    ]) {
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
    await screen.findByText('1 models · not updated yet');
    fireEvent.click(screen.getByRole('button', { name: 'AI titles model' }));
    expect(screen.getByRole('option', { name: 'New live model' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Fireworks models' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Out of credit or over the limit');
  });

  it('shows a feature readiness reason in plain words', async () => {
    const ai = aiFixture({ providers: [ANTHROPIC_OK] });
    ai.status.features['x-post-title'].reason = 'no_model';
    const settings = settingsFixture();
    settings.ai.features['x-post-title'].enabled = true;
    setup({ ai, settings });
    expect(await screen.findByText('Choose a model.', { selector: 'div' })).toBeTruthy();
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
      (screen.getByRole('button', { name: 'Remove Anthropic key' }) as HTMLButtonElement).disabled,
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
    expect((await screen.findByRole('alert')).textContent).toBe(words);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Anthropic key' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Replace Anthropic key' }));
    fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: TEST_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }));
    await screen.findByText('Testing…', { selector: 'button' });
    expect(screen.queryByDisplayValue(TEST_KEY)).toBeNull();
    expect(document.body.innerHTML).not.toContain(TEST_KEY);
    expect(
      (screen.getByRole('button', { name: 'Remove Anthropic key' }) as HTMLButtonElement).disabled,
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
    fireEvent.click(await screen.findByRole('button', { name: 'Replace Anthropic key' }));
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
    expect(await screen.findByText("Key can't be read. Add it again.")).toBeTruthy();
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
