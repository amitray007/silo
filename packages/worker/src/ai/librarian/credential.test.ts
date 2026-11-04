import { resolveAiCredential, resolveAiFeatureCredential } from '@silo/core/ai-credential';
import { afterEach, expect, it, vi } from 'vitest';
import { credential } from '../test-helpers.js';
import { answerCredential } from './credential.js';

vi.mock('@silo/core/ai-credential', () => ({
  resolveAiCredential: vi.fn(),
  resolveAiFeatureCredential: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
it('uses the saved answer model when it is valid and keyed', async () => {
  vi.mocked(resolveAiCredential).mockResolvedValue(credential);
  expect(await answerCredential({ provider: credential.kind, ...credential.model })).toBe(
    credential,
  );
  expect(resolveAiFeatureCredential).not.toHaveBeenCalled();
});
it.each(['invalid', 'unkeyed'])('falls back for an %s saved model', async (id) => {
  vi.mocked(resolveAiCredential).mockResolvedValue(undefined);
  vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
  expect(await answerCredential({ provider: 'openai', id })).toBe(credential);
  expect(resolveAiCredential).toHaveBeenCalledWith('openai', id);
  expect(resolveAiFeatureCredential).toHaveBeenCalledWith('librarian');
});
