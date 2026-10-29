import { AI_FEATURES } from '@silo/core';
import { xPostTitle } from '../enrich-source/twitter-title/index.js';
import type { AiFeatureDefinition } from './define.js';

/** Every feature's behavior. */
// biome-ignore lint/suspicious/noExplicitAny: a registry holds definitions with different input and output types.
export const AI_FEATURE_DEFINITIONS: readonly AiFeatureDefinition<any, any, any>[] = [xPostTitle];

/** Throws when the worker's definitions and core's feature list name different features. */
export function assertAiRegistryMatchesCore(
  definitionIds: Iterable<string>,
  coreIds: Iterable<string>,
): void {
  const worker = new Set(definitionIds);
  const core = new Set(coreIds);
  const missingDefinition = [...core].filter((id) => !worker.has(id));
  const missingCore = [...worker].filter((id) => !core.has(id));
  if (missingDefinition.length > 0 || missingCore.length > 0) {
    throw new Error(
      `AI feature registry drift: core features without a worker definition [${missingDefinition.join(', ')}], ` +
        `worker definitions without a core feature [${missingCore.join(', ')}]`,
    );
  }
}

// Module-load guard (like enrich-source/index.ts).
assertAiRegistryMatchesCore(
  AI_FEATURE_DEFINITIONS.map((definition) => definition.id),
  AI_FEATURES.map((feature) => feature.id),
);
