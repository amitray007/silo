import type { AiCredential } from '@silo/core/ai-credential';
import { type generateText, NoObjectGeneratedError, NoOutputGeneratedError, RetryError } from 'ai';

type Settings = Pick<
  Parameters<typeof generateText>[0],
  'providerOptions' | 'reasoning' | 'timeout' | 'maxOutputTokens' | 'abortSignal'
> & { structuredOutput: boolean };
type Option = 'reasoning' | 'thinking' | 'effort' | 'temperature' | 'format';
const remembered = new Map<string, Set<Option>>();

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
function rejectedOption(error: unknown): Option | undefined {
  let current: unknown = RetryError.isInstance(error) ? error.lastError : error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const failure = current as { statusCode?: unknown; message?: unknown; cause?: unknown };
    if (failure.statusCode === 401 || failure.statusCode === 403) return undefined;
    if (failure.statusCode === 400 && typeof failure.message === 'string') {
      const option = optionInMessage(failure.message);
      if (option) return option;
    }
    current = failure.cause;
  }
  return undefined;
}

function optionInMessage(message: string): Option | undefined {
  if (/response.?format|output.?format|structured.?output|output_config[. ]format/i.test(message))
    return 'format';
  if (/thinking/i.test(message)) return 'thinking';
  if (/reasoning/i.test(message)) return 'reasoning';
  if (/effort/i.test(message)) return 'effort';
  if (/temperature/i.test(message)) return 'temperature';
  return undefined;
}

const OMIT_FIELDS: Record<Option, string[]> = {
  format: ['structuredOutputMode'],
  reasoning: ['thinking', 'effort', 'reasoningEffort', 'reasoningBudget'],
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
  const previous = remembered.get(key);
  for (const option of previous ?? []) omitOption(settings, option);
  const retries: { rejected?: Option; increasedBudget: boolean } = { increasedBudget: false };
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
      rememberSettings(key, previous, retries.rejected);
      return result;
    } catch (error) {
      if (applyFallback(error, settings, retries)) continue;
      throw error;
    }
  }
}

function applyFallback(
  error: unknown,
  settings: Settings,
  retries: { rejected?: Option; increasedBudget: boolean },
): boolean {
  const option = rejectedOption(error);
  if (!retries.rejected && option && omitOption(settings, option)) {
    retries.rejected = option;
    return true;
  }
  if (!retries.increasedBudget && exhausted(error)) {
    settings.maxOutputTokens = 4096;
    retries.increasedBudget = true;
    return true;
  }
  return false;
}
function rememberSettings(
  key: string,
  previous: Set<Option> | undefined,
  rejected: Option | undefined,
): void {
  if (!rejected) return;
  if (remembered.size >= 500) remembered.clear();
  remembered.set(key, new Set([...(previous ?? []), rejected]));
}
