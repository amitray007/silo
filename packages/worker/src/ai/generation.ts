import type { AiCredential } from '@silo/core/ai-credential';
import {
  type generateText,
  type LanguageModel,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
  wrapLanguageModel,
} from 'ai';

type Settings = Pick<
  Parameters<typeof generateText>[0],
  'providerOptions' | 'reasoning' | 'timeout' | 'maxOutputTokens' | 'abortSignal'
> & { structuredOutput: boolean };
type Option = 'reasoning' | 'thinking' | 'effort' | 'temperature' | 'format';
const remembered = new Map<string, { options: Set<Option>; expiresAt: number }>();
const REMEMBERED_LIMIT = 200;
const REMEMBERED_TTL_MS = 7 * 24 * 60 * 60_000;

function settingsFor(credential: AiCredential): Settings {
  const { kind, model } = credential;
  const reasoning = model.reasoning;
  const settings: Settings = { maxOutputTokens: 1024, structuredOutput: true };
  switch (kind) {
    case 'fireworks':
      settings.providerOptions = { fireworks: { reasoningEffort: 'low' } };
      break;
    case 'anthropic':
      settings.providerOptions = anthropicOptions(model);
      break;
    case 'openai':
      if (reasoning.type === 'openai' && reasoning.effort)
        settings.providerOptions = { openai: { reasoningEffort: reasoning.effort } };
      break;
    case 'gateway':
      applyGatewaySettings(settings, reasoning);
      break;
  }
  return settings;
}

function anthropicOptions(model: AiCredential['model']): NonNullable<Settings['providerOptions']> {
  const reasoning = model.reasoning;
  if (reasoning.type !== 'anthropic') return {};
  return {
    anthropic: {
      ...(model.structuredOutput === 'native' ? { structuredOutputMode: 'outputFormat' } : {}),
      ...(reasoning.thinking
        ? {
            thinking: {
              type: reasoning.thinking,
              ...(reasoning.thinking === 'enabled' ? { budgetTokens: 1024 } : {}),
            },
          }
        : {}),
      ...(reasoning.effort ? { effort: reasoning.effort } : {}),
    },
  };
}
function applyGatewaySettings(
  settings: Settings,
  reasoning: AiCredential['model']['reasoning'],
): void {
  if (reasoning.type !== 'gateway') return;
  if (reasoning.effort) settings.reasoning = reasoning.effort;
  else if (reasoning.budgetTokens !== undefined)
    settings.providerOptions = { gateway: { reasoningBudget: reasoning.budgetTokens } };
}

/** Read messages only to identify a rejected option; never log or persist provider text. */
function rejectedOption(error: unknown, kind: AiCredential['kind']): Option | undefined {
  let current: unknown = RetryError.isInstance(error) ? error.lastError : error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const failure = current as { statusCode?: unknown; message?: unknown; cause?: unknown };
    if (failure.statusCode === 401 || failure.statusCode === 403) return undefined;
    if (failure.statusCode === 400 && typeof failure.message === 'string') {
      const option = optionInMessage(failure.message, kind);
      if (option) return option;
    }
    current = failure.cause;
  }
  return undefined;
}

const FORMAT_PATTERN =
  /\b(?:response[_ .]?format|output[_ .]?format|structured[_ .]?output|output_config[. ]format)\b/i;
const REJECTED_OPTIONS: Record<AiCredential['kind'], readonly (readonly [Option, RegExp])[]> = {
  anthropic: [
    ['format', FORMAT_PATTERN],
    ['thinking', /\bthinking\b/i],
    ['effort', /\beffort\b/i],
    ['reasoning', /\breasoning\b/i],
  ],
  openai: [
    ['format', FORMAT_PATTERN],
    ['reasoning', /\breasoning(?:[_ .]effort|[_ .]?summary)?\b/i],
    ['temperature', /\btemperature\b/i],
  ],
  gateway: [
    ['format', FORMAT_PATTERN],
    ['reasoning', /\b(?:reasoning(?:[_ .]effort|[_ .]budget)?|thinking|effort)\b/i],
    ['temperature', /\btemperature\b/i],
  ],
  // GLM: "disabling thinking (reasoning_effort='none') is not supported".
  fireworks: [
    ['format', FORMAT_PATTERN],
    ['reasoning', /\b(?:reasoning(?:_effort)?|thinking)\b/i],
    ['temperature', /\btemperature\b/i],
  ],
};

function optionInMessage(message: string, kind: AiCredential['kind']): Option | undefined {
  for (const [option, pattern] of REJECTED_OPTIONS[kind]) {
    for (const match of message.matchAll(new RegExp(pattern.source, 'gi'))) {
      const before = message.slice(0, match.index);
      const after = message.slice(match.index + match[0].length);
      // Require rejection of this parameter, not an unrelated error elsewhere in the message.
      if (
        /\b(?:unsupported|unknown|unrecognized|invalid)(?:\s+(?:parameter|option|argument|field|value|of|for|the))*\s*[:='"`([]*\s*$/i.test(
          before,
        ) ||
        /^[\s'"`)\]]*(?:\s*[:=]\s*['"]?[\w.-]+['"]?[\s)\]]*)?\s*(?:(?:is|are|was)\s+)?(?:unsupported|not supported|invalid|unknown|unrecognized)\b/i.test(
          after,
        )
      )
        return option;
    }
  }
  return undefined;
}

const OMIT_FIELDS: Record<Option, string[]> = {
  format: ['structuredOutputMode'],
  reasoning: ['thinking', 'effort', 'reasoningEffort', 'reasoningBudget', 'reasoningSummary'],
  effort: ['effort', 'reasoningEffort'],
  thinking: ['thinking'],
  temperature: ['temperature'],
};

function omitOption(settings: Settings, option: Option): boolean {
  let changed = false;
  if (option === 'format') {
    changed = settings.structuredOutput;
    settings.structuredOutput = false;
  }
  if (option === 'reasoning' || option === 'effort') {
    changed ||= settings.reasoning !== undefined;
    delete settings.reasoning;
  }
  return omitProviderOption(settings, option) || changed;
}

function omitProviderOption(settings: Settings, option: Option): boolean {
  let changed = false;
  for (const [provider, values] of Object.entries(settings.providerOptions ?? {})) {
    const fields = OMIT_FIELDS[option];
    for (const field of fields) {
      if (field in values) {
        delete values[field];
        changed = true;
      }
    }
    if (!Object.keys(values).length) delete settings.providerOptions?.[provider];
  }
  if (!Object.keys(settings.providerOptions ?? {}).length) delete settings.providerOptions;
  return changed;
}

function exhausted(error: unknown): boolean {
  if (NoObjectGeneratedError.isInstance(error)) return error.finishReason === 'length';
  if (!NoOutputGeneratedError.isInstance(error)) return false;
  const detail = error as { finishReason?: unknown; cause?: { finishReason?: unknown } };
  return detail.finishReason === 'length' || detail.cause?.finishReason === 'length';
}

/** Both fallback attempts share one deadline and caller cancellation. No auth retries. */
export async function withModelSettings<T>(
  credential: AiCredential,
  timeoutMs: number,
  generate: (settings: Settings) => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  const started = Date.now();
  const settings = settingsFor(credential);
  const key = `${credential.kind}:${credential.model.id}`;
  const previous = rememberedOptions(key);
  for (const option of previous ?? []) omitOption(settings, option);
  const retries: { rejected?: Option; increasedBudget: boolean; remember?: Option } = {
    increasedBudget: false,
  };
  while (true) {
    abortSignal?.throwIfAborted();
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw new DOMException('Generation timed out', 'TimeoutError');
    try {
      const result = await generate({
        ...structuredClone(settings),
        timeout: { totalMs: remaining },
        ...(abortSignal ? { abortSignal } : {}),
      });
      rememberSettings(key, previous, retries.remember);
      return result;
    } catch (error) {
      delete retries.remember;
      if (applyFallback(error, credential.kind, settings, retries)) continue;
      throw error;
    }
  }
}

function applyFallback(
  error: unknown,
  kind: AiCredential['kind'],
  settings: Settings,
  retries: { rejected?: Option; increasedBudget: boolean; remember?: Option },
): boolean {
  const option = rejectedOption(error, kind);
  if (!retries.rejected && option && omitOption(settings, option)) {
    retries.rejected = option;
    retries.remember = option;
    return true;
  }
  if (!retries.increasedBudget && exhausted(error)) {
    settings.maxOutputTokens = 4096;
    retries.increasedBudget = true;
    return true;
  }
  return false;
}
function rememberedOptions(key: string): Set<Option> | undefined {
  const cached = remembered.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt > Date.now()) return cached.options;
  remembered.delete(key);
  return undefined;
}

function rememberSettings(
  key: string,
  previous: Set<Option> | undefined,
  rejected: Option | undefined,
): void {
  if (!rejected) return;
  const now = Date.now();
  for (const [id, entry] of remembered) {
    if (entry.expiresAt <= now) remembered.delete(id);
  }
  remembered.delete(key);
  if (remembered.size >= REMEMBERED_LIMIT) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
  remembered.set(key, {
    options: new Set([...(previous ?? []), rejected]),
    expiresAt: now + REMEMBERED_TTL_MS,
  });
}

/** Ask the provider to return readable reasoning, for the chat only. Models without reasoning settings are left alone. */
function withReadableReasoning(credential: AiCredential, base: Settings): void {
  const { providerOptions } = base;
  if (credential.kind === 'anthropic') {
    const anthropic = providerOptions?.anthropic;
    const thinking = anthropic?.thinking as { type?: string } | undefined;
    if (anthropic && thinking?.type === 'adaptive')
      anthropic.thinking = { ...thinking, display: 'summarized' };
  }
  if (credential.kind === 'openai' && providerOptions?.openai?.reasoningEffort)
    providerOptions.openai.reasoningSummary = 'auto';
}

type Thinking = 'off' | 'low' | 'medium' | 'high';
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
function clampEffort(value: Thinking, supported: readonly string[]): string | undefined {
  const target = value === 'off' ? 0 : EFFORTS.indexOf(value);
  return [...supported].sort(
    (a, b) =>
      Math.abs(EFFORTS.indexOf(a as (typeof EFFORTS)[number]) - target) -
      Math.abs(EFFORTS.indexOf(b as (typeof EFFORTS)[number]) - target),
  )[0];
}
function applyChatThinking(base: Settings, credential: AiCredential, thinking: Thinking): void {
  const reasoning = credential.model.reasoning;
  if (reasoning.type === 'openai' && reasoning.effort) {
    const minimum = reasoning.effort;
    base.providerOptions = { openai: { reasoningEffort: thinking === 'off' ? minimum : thinking } };
  }
  if (reasoning.type === 'fireworks')
    base.providerOptions = {
      fireworks: { reasoningEffort: thinking === 'off' ? 'none' : thinking },
    };
  applyGatewayThinking(base, reasoning, thinking);
  applyAnthropicThinking(base, reasoning, thinking);
}
function applyGatewayThinking(
  base: Settings,
  reasoning: AiCredential['model']['reasoning'],
  thinking: Thinking,
): void {
  if (reasoning.type !== 'gateway') return;
  if (reasoning.efforts?.length) {
    base.reasoning = clampEffort(thinking, reasoning.efforts) as NonNullable<Settings['reasoning']>;
  }
}
function applyAnthropicThinking(
  base: Settings,
  reasoning: AiCredential['model']['reasoning'],
  thinking: Thinking,
): void {
  if (reasoning.type !== 'anthropic') return;
  const options = base.providerOptions?.anthropic;
  if (!options) return;
  const modes = reasoning.thinkingModes ?? (reasoning.thinking ? [reasoning.thinking] : []);
  if (thinking === 'off' && modes.includes('disabled')) {
    options.thinking = { type: 'disabled' };
    delete options.effort;
    return;
  }
  const mode = modes.includes('adaptive') ? 'adaptive' : modes.find((mode) => mode !== 'disabled');
  if (mode)
    options.thinking = { type: mode, ...(mode === 'enabled' ? { budgetTokens: 1024 } : {}) };
  const effort = clampEffort(
    thinking,
    reasoning.efforts ?? (reasoning.effort ? [reasoning.effort] : []),
  );
  if (effort) options.effort = effort;
}

export function chatModelSettings(
  credential: AiCredential,
  options: { promptCache?: boolean; readableReasoning?: boolean; thinking?: Thinking } = {},
) {
  const base = settingsFor(credential);
  if (options.thinking) applyChatThinking(base, credential, options.thinking);
  if (options.readableReasoning) withReadableReasoning(credential, base);
  for (const option of rememberedOptions(`${credential.kind}:${credential.model.id}`) ?? [])
    omitOption(base, option);
  if (options.promptCache && (credential.kind === 'anthropic' || credential.kind === 'gateway')) {
    const provider = credential.kind;
    base.providerOptions = {
      ...base.providerOptions,
      [provider]: {
        ...base.providerOptions?.[provider],
        ...(provider === 'anthropic'
          ? { cacheControl: { type: 'ephemeral' } }
          : { caching: 'auto' }),
      },
    };
  }
  omitOption(base, 'format');
  const { structuredOutput: _structuredOutput, ...settings } = base;
  return { ...settings, maxOutputTokens: 4096 };
}

/** Retry only while the provider has emitted no content. Later stream failures pass through. */
export function chatStreamingModel(
  model: LanguageModel,
  credential: AiCredential,
  thinking?: Thinking,
) {
  if (typeof model === 'string') throw new Error('Expected provider model');
  let started = false;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v4',
      wrapStream: async ({ model, params }) => {
        const key = `${credential.kind}:${credential.model.id}`;
        const previous = rememberedOptions(key);
        const settings: Settings = {
          ...chatModelSettings(credential, {
            ...(thinking ? { thinking } : {}),
            promptCache: true,
            readableReasoning: true,
          }),
          structuredOutput: false,
        };
        const attempt = async () => {
          const { reasoning: _reasoning, ...rest } = params;
          const result = await model.doStream({
            ...rest,
            ...(settings.reasoning ? { reasoning: settings.reasoning } : {}),
            providerOptions: settings.providerOptions ?? {},
          });
          const stream = await primeStream(result.stream);
          started = true;
          return { ...result, stream };
        };
        try {
          return await attempt();
        } catch (error) {
          const option = rejectedOption(error, credential.kind);
          if (started || !option || !omitOption(settings, option)) throw error;
          const result = await attempt();
          rememberSettings(key, previous, option);
          return result;
        }
      },
    },
  });
}

function replayStream<T>(buffered: (T | undefined)[], reader: ReadableStreamDefaultReader<T>) {
  return new ReadableStream<T>({
    async pull(controller) {
      const first = buffered.shift();
      if (first !== undefined) {
        controller.enqueue(first);
        return;
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

async function primeStream<T extends { type: string; error?: unknown }>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  const buffered: T[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.type === 'error') throw next.value.error;
      buffered.push(next.value);
      if (!['stream-start', 'response-metadata', 'raw'].includes(next.value.type)) break;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return replayStream(buffered, reader);
}
