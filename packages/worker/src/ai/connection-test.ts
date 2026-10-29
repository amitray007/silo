import type { AiConnectionTester } from '@silo/core/ai-credential';
import { generateText, NoOutputGeneratedError } from 'ai';
import { aiErrorCode } from './errors.js';
import { withModelSettings } from './generation.js';
import { languageModelFor } from './model.js';

const TEST_PROMPT = 'Reply with the word ok.';
const TEST_TIMEOUT_MS = 15_000;

/** One short call with the credential's own model: checks the key and the model together. Never throws. */
export const aiConnectionTester: AiConnectionTester = async (credential) => {
  const started = Date.now();
  try {
    const timeoutMs = credential.kind === 'fireworks' ? 30_000 : TEST_TIMEOUT_MS;
    await withModelSettings(
      credential,
      timeoutMs,
      async ({ structuredOutput: _structuredOutput, ...settings }) => {
        const result = await generateText({
          model: languageModelFor(credential),
          prompt: TEST_PROMPT,
          maxRetries: 0,
          ...settings,
          telemetry: { isEnabled: false },
        });
        if (result.finishReason === 'length' && !result.text) {
          throw new NoOutputGeneratedError({
            cause: Object.assign(new Error('Output budget exhausted'), { finishReason: 'length' }),
          });
        }
        return result;
      },
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
