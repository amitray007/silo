import { type AiErrorCode, isAiFeatureOn } from '@silo/core';
import { type AiCredential, resolveAiFeatureCredential } from '@silo/core/ai-credential';
import {
  generateText,
  type LanguageModel,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from 'ai';
import type { AiFeatureDefinition } from './define.js';
import { aiErrorCode, logAiFailure } from './errors.js';
import { withModelSettings } from './generation.js';
import { languageModelFor } from './model.js';
import './registry.js'; // runs the registry drift guard in every process that runs a feature

export type AiRunResult<Out> =
  | { ok: true; value: Out }
  | { ok: false; code: AiErrorCode | 'off' | 'invalid_output' };

/** Injectable seams so tests need no database and no network. */
export type AiRunDeps = {
  isFeatureOn: typeof isAiFeatureOn;
  credential: (id: Parameters<typeof isAiFeatureOn>[0]) => Promise<AiCredential | undefined>;
  model: (credential: AiCredential) => LanguageModel;
  abortSignal?: AbortSignal | undefined;
};

const defaultDeps: AiRunDeps = {
  isFeatureOn: isAiFeatureOn,
  credential: resolveAiFeatureCredential,
  model: languageModelFor,
};

/**
 * The one entry every AI feature uses. Never throws: any failure returns a
 * code and the caller uses its non-AI result. Logs one fixed line per failure.
 */
export async function runAiFeature<In, Out, Raw>(
  definition: AiFeatureDefinition<In, Out, Raw>,
  input: In,
  deps: Partial<AiRunDeps> = {},
): Promise<AiRunResult<Out>> {
  const {
    isFeatureOn,
    credential: loadCredential,
    model,
    abortSignal,
  } = { ...defaultDeps, ...deps };
  try {
    abortSignal?.throwIfAborted();
    const featureOn = await isFeatureOn(definition.id);
    abortSignal?.throwIfAborted();
    if (!featureOn) return { ok: false, code: 'off' };
    const credential = await loadCredential(definition.id);
    abortSignal?.throwIfAborted();
    if (!credential) return { ok: false, code: 'off' };

    const output = await withModelSettings(
      credential,
      definition.timeoutMs,
      async ({ structuredOutput, ...settings }) => {
        const output = Output.object({ schema: definition.schema });
        const result = await generateText({
          model: model(credential),
          instructions: definition.instructions,
          prompt: definition.buildPrompt(input),
          output: structuredOutput
            ? output
            : { ...output, responseFormat: Promise.resolve({ type: 'text' as const }) },
          maxRetries: 2,
          ...settings,
          telemetry: { isEnabled: false },
        });
        if (result.finishReason === 'length' && !result.text) {
          throw new NoOutputGeneratedError({
            cause: Object.assign(new Error('Output budget exhausted'), { finishReason: 'length' }),
          });
        }
        return result.output;
      },
      abortSignal,
    );
    abortSignal?.throwIfAborted();
    const value = definition.postProcess(output);
    if (value === undefined) {
      logAiFailure(definition.id, definition.promptVersion, 'invalid_output');
      return { ok: false, code: 'invalid_output' };
    }
    return { ok: true, value };
  } catch (error) {
    // A model that returns unparseable or schema-invalid output throws NoObjectGeneratedError.
    const code = abortSignal?.aborted
      ? 'timeout'
      : NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)
        ? 'invalid_output'
        : aiErrorCode(error);
    logAiFailure(definition.id, definition.promptVersion, code);
    return { ok: false, code };
  }
}
