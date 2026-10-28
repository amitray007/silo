import { AI_FEATURES } from '@silo/core';
import type { AiFeatureDefinition } from './define.js';

/** Every feature's behavior. Empty until the first feature registers itself. */
// biome-ignore lint/suspicious/noExplicitAny: a registry holds definitions with different input and output types.
export const AI_FEATURE_DEFINITIONS: readonly AiFeatureDefinition<any, any, any>[] = [];

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

// Module-load guard (like enrich-source/index.ts). `AiFeatureId` is `never`
// while the registry is empty, which collapses the element types, hence the casts.
assertAiRegistryMatchesCore(
  (AI_FEATURE_DEFINITIONS as readonly { id: string }[]).map((definition) => definition.id),
  (AI_FEATURES as readonly { id: string }[]).map((feature) => feature.id),
);
