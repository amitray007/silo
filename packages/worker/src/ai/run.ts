import { type AiErrorCode, isAiFeatureOn } from '@silo/core';
import { type AiCredential, resolveAiCredential } from '@silo/core/ai-credential';
import {
  generateText,
  type LanguageModel,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from 'ai';
import type { AiFeatureDefinition } from './define.js';
import { aiErrorCode, logAiFailure } from './errors.js';
import { languageModelFor } from './model.js';
import './registry.js'; // runs the registry drift guard in every process that runs a feature

const DEFAULT_MAX_OUTPUT_TOKENS = 200;

export type AiRunResult<Out> =
  | { ok: true; value: Out }
  | { ok: false; code: AiErrorCode | 'off' | 'invalid_output' };

/** Injectable seams so tests need no database and no network. */
export type AiRunDeps = {
  isFeatureOn: typeof isAiFeatureOn;
  credential: () => Promise<AiCredential | undefined>;
  model: (credential: AiCredential) => LanguageModel;
};

const defaultDeps: AiRunDeps = {
  isFeatureOn: isAiFeatureOn,
  credential: () => resolveAiCredential(),
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
  const { isFeatureOn, credential: loadCredential, model } = { ...defaultDeps, ...deps };
  try {
    if (!(await isFeatureOn(definition.id))) return { ok: false, code: 'off' };
    const credential = await loadCredential();
    if (!credential) return { ok: false, code: 'off' };

    const { output } = await generateText({
      model: model(credential),
      instructions: definition.instructions,
      prompt: definition.buildPrompt(input),
      output: Output.object({ schema: definition.schema }),
      reasoning: credential.model.reasoning,
      maxRetries: 2,
      timeout: { totalMs: definition.timeoutMs },
      maxOutputTokens: definition.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      telemetry: { isEnabled: false },
    });
    const value = definition.postProcess(output);
    if (value === undefined) {
      logAiFailure(definition.id, definition.promptVersion, 'invalid_output');
      return { ok: false, code: 'invalid_output' };
    }
    return { ok: true, value };
  } catch (error) {
    // A model that returns unparseable or schema-invalid output throws NoObjectGeneratedError.
    const code =
      NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)
        ? 'invalid_output'
        : aiErrorCode(error);
    logAiFailure(definition.id, definition.promptVersion, code);
    return { ok: false, code };
  }
}
