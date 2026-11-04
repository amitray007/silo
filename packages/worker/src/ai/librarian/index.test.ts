import { type AiCredential, setLibrarianSuggestionsRunner } from '@silo/core/ai-credential';
import { expect, it, vi } from 'vitest';
import { credential } from '../test-helpers.js';
import { answerCredential } from './credential.js';
import { registerLibrarian } from './index.js';
import { suggestFollowups } from './suggestions.js';

vi.mock('@silo/core/ai-credential', () => ({
  setLibrarianRunner: vi.fn(),
  setLibrarianSuggestionsRunner: vi.fn(),
}));
vi.mock('./credential.js', () => ({ answerCredential: vi.fn() }));
vi.mock('./run.js', () => ({ runLibrarian: vi.fn() }));
vi.mock('../model.js', () => ({ languageModelFor: vi.fn(() => 'model') }));
vi.mock('./suggestions.js', () => ({ suggestFollowups: vi.fn(async () => []) }));

it.each([credential, undefined])(
  'selects the saved answer credential for follow-ups',
  async (resolved: AiCredential | undefined) => {
    vi.mocked(answerCredential).mockResolvedValue(resolved);
    const registration = registerLibrarian();
    const runner = vi.mocked(setLibrarianSuggestionsRunner).mock.calls.at(-1)?.[0];
    const model = { provider: credential.kind, ...credential.model };
    if (!runner) throw new Error('missing runner');
    const result = await runner('question', 'answer', model);
    expect(answerCredential).toHaveBeenLastCalledWith(model);
    if (resolved)
      expect(suggestFollowups).toHaveBeenLastCalledWith(credential, 'model', 'question', 'answer');
    else expect(result).toBeNull();
    registration.close();
  },
);
