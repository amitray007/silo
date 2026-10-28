import type { AiConnectionTester } from '@silo/core/ai-credential';
import { generateText, NoOutputGeneratedError } from 'ai';
import { aiErrorCode } from './errors.js';
import { FIREWORKS_MAX_OUTPUT_TOKENS, withFireworksReasoning } from './fireworks-generation.js';
import { languageModelFor } from './model.js';

const TEST_PROMPT = 'Reply with the word ok.';
const TEST_TIMEOUT_MS = 15_000;
const TEST_MAX_OUTPUT_TOKENS = 256;

/** One short call with the credential's own model: checks the key and the model together. Never throws. */
export const aiConnectionTester: AiConnectionTester = async (credential) => {
  const started = Date.now();
  try {
    const timeoutMs = credential.kind === 'fireworks' ? 30_000 : TEST_TIMEOUT_MS;
    await withFireworksReasoning(credential.kind, timeoutMs, (settings) =>
      generateText({
        model: languageModelFor(credential),
        prompt: TEST_PROMPT,
        ...(credential.kind === 'fireworks' ? {} : { reasoning: credential.model.reasoning }),
        maxRetries: 0,
        ...settings,
        maxOutputTokens:
          credential.kind === 'fireworks' ? FIREWORKS_MAX_OUTPUT_TOKENS : TEST_MAX_OUTPUT_TOKENS,
        telemetry: { isEnabled: false },
      }),
    );
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    // The provider answered; the test never needs the content.
    if (NoOutputGeneratedError.isInstance(error)) {
      return { ok: true, latencyMs: Date.now() - started };
    }
    return { ok: false, code: aiErrorCode(error), latencyMs: Date.now() - started };
  }
};
