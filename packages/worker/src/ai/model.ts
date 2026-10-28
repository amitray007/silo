import { createAnthropic } from '@ai-sdk/anthropic';
import { createFireworks } from '@ai-sdk/fireworks';
import { createOpenAI } from '@ai-sdk/openai';
import type { AiCredential } from '@silo/core/ai-credential';
import { createGateway, type LanguageModel } from 'ai';

// Provider warnings can echo request details; silo logs its own fixed lines instead.
// Every generateText caller imports this file, so the flag is set before any call.
globalThis.AI_SDK_LOG_WARNINGS = false;

// Explicit URLs: ANTHROPIC_BASE_URL / OPENAI_BASE_URL must never redirect a stored key.
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * The only file that knows provider SDKs. The key is always passed explicitly:
 * an empty key throws instead of letting a provider fall back to
 * ANTHROPIC_API_KEY, OPENAI_API_KEY or AI_GATEWAY_API_KEY in the environment.
 */
export function languageModelFor(
  credential: AiCredential,
  fetch?: typeof globalThis.fetch,
): LanguageModel {
  const apiKey = credential.apiKey.trim();
  if (!apiKey) throw new Error('AI provider key is empty');
  const id = credential.model.id;
  switch (credential.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL, ...(fetch ? { fetch } : {}) })(
        id,
      );
    case 'openai':
      return createOpenAI({ apiKey, baseURL: OPENAI_BASE_URL, ...(fetch ? { fetch } : {}) })(id);
    case 'fireworks':
      return createFireworks({
        apiKey,
        baseURL: 'https://api.fireworks.ai/inference/v1',
        ...(fetch ? { fetch } : {}),
      })(id);
    case 'gateway':
      if (
        credential.model.reasoning.type === 'gateway' &&
        credential.model.reasoning.budgetTokens !== undefined
      )
        return gatewayBudgetModel(apiKey, id, fetch);
      return createGateway({ apiKey, ...(fetch ? { fetch } : {}) })(id);
  }
}

/** SDK 7's portable reasoning accepts effort only. Budget-only Gateway models use its documented Chat Completions extension. */
function gatewayBudgetModel(
  apiKey: string,
  id: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): ReturnType<ReturnType<typeof createGateway>['languageModel']> {
  const gateway = createGateway({ apiKey, fetch })(id);
  const compatible = (budget: unknown) =>
    createOpenAI({
      apiKey,
      baseURL: 'https://ai-gateway.vercel.sh/v1',
      fetch: (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (typeof budget === 'number') body.reasoning = { max_tokens: budget };
        return fetch(url, { ...init, body: JSON.stringify(body) });
      },
    }).chat(id);

  return {
    specificationVersion: 'v4',
    provider: gateway.provider,
    modelId: id,
    supportedUrls: gateway.supportedUrls,
    doStream: (options) =>
      compatible(options.providerOptions?.gateway?.reasoningBudget).doStream(options),
    doGenerate: (options) =>
      compatible(options.providerOptions?.gateway?.reasoningBudget).doGenerate(options),
  };
}
