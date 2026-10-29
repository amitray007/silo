import { expect, it } from 'vitest';

it('importing run.ts silences AI SDK warnings', async () => {
  (globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = undefined;
  await import('./run.js');
  expect(globalThis.AI_SDK_LOG_WARNINGS).toBe(false);
});
