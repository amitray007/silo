import { setAiConnectionTester } from '@silo/core/ai-credential';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAiConnectionTester } from './index.js';

vi.mock('@silo/core/ai-credential', async (original) => ({
  ...(await original<typeof import('@silo/core/ai-credential')>()),
  setAiConnectionTester: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe('registerAiConnectionTester', () => {
  it('registers the tester and close() unregisters it', () => {
    const handle = registerAiConnectionTester();
    expect(vi.mocked(setAiConnectionTester).mock.calls[0]?.[0]).toBeTypeOf('function');
    handle.close();
    expect(vi.mocked(setAiConnectionTester).mock.calls[1]).toEqual([undefined]);
  });
});
