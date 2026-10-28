import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { type AiCredential, providerModelId } from '@silo/core';
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
  const id = providerModelId(credential.model, credential.kind);
  switch (credential.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL, ...(fetch ? { fetch } : {}) })(
        id,
      );
    case 'openai':
      return createOpenAI({ apiKey, baseURL: OPENAI_BASE_URL, ...(fetch ? { fetch } : {}) })(id);
    case 'gateway':
      return createGateway({ apiKey, ...(fetch ? { fetch } : {}) })(id);
  }
}
