import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicModelsFetcher } from './anthropic-models.js';
import { createGatewayModelsFetcher } from './gateway-models.js';
import { createOpenAiModelsFetcher, isOpenAiTitleModel, openAiReasoning } from './openai-models.js';

const KEY = 'fake-key-never-echo';
const support = (supported: boolean) => ({ supported });
const anthropic = (id: string, extra = {}) => ({
  id,
  display_name: id,
  type: 'model',
  created_at: '2026-10-07T18:00:00Z',
  lifecycle: 'active',
  max_input_tokens: 1000000,
  max_tokens: 128000,
  capabilities: {
    structured_outputs: support(true),
    thinking: { types: { disabled: support(true), adaptive: support(true) } },
    effort: { supported: true, low: support(true), high: support(true) },
  },
  ...extra,
});
const gateway = (id: string, extra = {}) => ({
  id,
  name: id,
  owned_by: 'anthropic',
  type: 'language',
  tags: ['structured-output', 'reasoning'],
  released: 1791331200,
  context_window: 1000000,
  max_tokens: 128000,
  eligible: true,
  reasoning_options: [{ type: 'effort', values: ['high', 'low', 'medium'] }],
  ...extra,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Anthropic models', () => {
  it('pages with the pinned version, filters lifecycle and structured output, and retains unknown capabilities', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            anthropic('claude-haiku-5-5'),
            anthropic('deprecated', { lifecycle: 'deprecated' }),
            anthropic('no-json', { capabilities: { structured_outputs: support(false) } }),
          ],
          last_id: 'cursor+/=',
          first_id: 'first',
          has_more: true,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            anthropic('unknown', { capabilities: undefined, lifecycle: undefined }),
            anthropic('expired', { lifecycle: undefined, retires_at: '2000-01-01T00:00:00Z' }),
          ],
          last_id: 'last',
          has_more: false,
        }),
      );
    const result = await createAnthropicModelsFetcher(fetch)(KEY);
    expect(result).toEqual({
      ok: true,
      models: [
        {
          id: 'claude-haiku-5-5',
          label: 'claude-haiku-5-5',
          owner: 'anthropic',
          createdAt: '2026-10-07T18:00:00Z',
          contextWindow: 1000000,
          maxOutputTokens: 128000,
          structuredOutput: 'native',
          reasoning: { type: 'anthropic', thinking: 'disabled', effort: 'low' },
        },
        {
          id: 'unknown',
          label: 'unknown',
          owner: 'anthropic',
          createdAt: '2026-10-07T18:00:00Z',
          contextWindow: 1000000,
          maxOutputTokens: 128000,
          structuredOutput: 'unknown',
          reasoning: { type: 'anthropic' },
        },
      ],
    });
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('after_id')).toBe(
      'cursor+/=',
    );
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('limit')).toBe('1000');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { 'x-api-key': KEY, 'anthropic-version': '2026-10-21' },
      redirect: 'error',
    });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(fetch.mock.calls[1]?.[1]?.signal);
  });
  it.each([
    ['sonnet', 'between_tools'],
    ['opus', 'adaptive'],
  ] as const)('chooses the lightest supported thinking for %s', async (line, thinking) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        data: [
          anthropic(`claude-${line}-5-5`, {
            capabilities: {
              structured_outputs: support(true),
              thinking: {
                types: {
                  disabled: support(false),
                  between_tools: support(line === 'sonnet'),
                  adaptive: support(true),
                },
              },
              effort: { low: support(true) },
            },
          }),
        ],
        has_more: false,
      }),
    );
    expect(await createAnthropicModelsFetcher(fetch)(KEY)).toMatchObject({
      ok: true,
      models: [{ reasoning: { type: 'anthropic', thinking, effort: 'low' } }],
    });
  });
  it('rejects missing and repeated cursors instead of storing a partial result', async () => {
    for (const last_id of [null, 'repeat']) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () =>
          Response.json({ data: [anthropic('valid')], has_more: true, last_id }),
        );
      expect(await createAnthropicModelsFetcher(fetch)(KEY)).toEqual({
        ok: false,
        code: 'provider_error',
      });
    }
  });
});

describe('OpenAI family rules', () => {
  it.each([
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-nano-2025-04-14',
    'gpt-5-mini',
    'gpt-6-luna',
    'gpt-6.1-sol',
    'gpt-6-astra-2026-09-04',
    'gpt-9.2-terra',
    'o3',
    'o4-mini-2025-04-16',
  ])('admits %s', (id) => expect(isOpenAiTitleModel(id)).toBe(true));
  it.each([
    'ft:gpt-5:mine',
    'gpt-6-pro',
    'gpt-6-codex',
    'gpt-4o-audio-preview',
    'gpt-4o-realtime',
    'gpt-5-search',
    'gpt-image-1',
    'text-embedding-3-small',
    'omni-moderation-latest',
    'gpt-6-luna-image',
    'gpt-7-unknown',
    'gpt-5-chat-latest',
    'o3-pro',
    'prefix-gpt-6-luna',
    'gpt-6-luna-junk',
  ])('excludes %s', (id) => expect(isOpenAiTitleModel(id)).toBe(false));
  it.each([
    ['gpt-6-astra', 'low'],
    ['gpt-6.1-sol', 'low'],
    ['gpt-6-luna', 'none'],
    ['gpt-6.1-terra', 'none'],
    ['gpt-5', 'minimal'],
    ['gpt-5-mini', 'minimal'],
    ['gpt-5-nano-2025-08-07', 'minimal'],
    ['gpt-5.1', 'none'],
    ['o4-mini', 'low'],
    ['gpt-4o', undefined],
    ['gpt-4.1-mini', undefined],
    ['gpt-4.1-nano', undefined],
  ])('chooses effort for %s', (id, effort) =>
    expect(openAiReasoning(id ?? '')).toEqual({ type: 'openai', ...(effort ? { effort } : {}) }),
  );
  it('uses bearer auth at the fixed host and drops shutdown and specialized models', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        data: [
          { id: 'gpt-6-luna', created: 1790035200, owned_by: 'openai' },
          { id: 'gpt-5-mini', shutdown_date: '2000-01-01' },
          { id: 'gpt-6-codex' },
        ],
      }),
    );
    expect(await createOpenAiModelsFetcher(fetch)(KEY)).toEqual({
      ok: true,
      models: [
        {
          id: 'gpt-6-luna',
          label: 'gpt-6-luna',
          owner: 'openai',
          createdAt: '2026-09-22T00:00:00.000Z',
          structuredOutput: 'unknown',
          reasoning: { type: 'openai', effort: 'none' },
        },
      ],
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://api.openai.com/v1/models');
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${KEY}` });
  });
});

describe('Gateway models', () => {
  it('filters language, JSON, eligibility and deprecation and keeps the lowest reasoning control', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        data: [
          gateway('anthropic/claude-opus-5.5'),
          gateway('toggle', { reasoning_options: [{ type: 'toggle' }] }),
          gateway('budget', {
            reasoning_options: [{ type: 'budget_tokens', min: 64, max: 8192 }],
          }),
          gateway('image', { type: 'image' }),
          gateway('no-json', { tags: [] }),
          gateway('no-access', { eligible: false }),
          gateway('denied', { eligibility: { eligible: false } }),
          gateway('deprecated', { deprecated_at: 1999999999999 }),
        ],
      }),
    );
    const result = await createGatewayModelsFetcher(fetch)(KEY);
    expect(result.ok && result.models.map((m) => [m.id, m.reasoning])).toEqual([
      ['anthropic/claude-opus-5.5', { type: 'gateway', effort: 'low' }],
      ['toggle', { type: 'gateway', effort: 'none' }],
      ['budget', { type: 'gateway', budgetTokens: 64 }],
    ]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://ai-gateway.vercel.sh/v1/models?include_availability',
    );
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${KEY}` });
  });
  it('accepts payloads above 2 MB and rejects payloads above 4 MB', async () => {
    for (const [size, ok] of [
      [3 * 1024 * 1024, true],
      [4 * 1024 * 1024 + 1, false],
    ] as const) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [gateway('valid')] }).padEnd(size, ' ')),
        );
      expect((await createGatewayModelsFetcher(fetch)(KEY)).ok).toBe(ok);
    }
  });
});

it.each([createAnthropicModelsFetcher, createOpenAiModelsFetcher, createGatewayModelsFetcher])(
  'keeps provider errors coded and never consumes their body',
  async (create) => {
    for (const [status, code] of [
      [401, 'invalid_key'],
      [403, 'no_access'],
      [429, 'rate_limited'],
    ] as const) {
      const response = new Response(KEY, { status });
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
      expect(await create(fetch)(KEY)).toEqual({ ok: false, code });
      expect(response.bodyUsed).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  },
);
