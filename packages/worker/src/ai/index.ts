import { setAiConnectionTester, setAiModelsFetcher } from '@silo/core/ai-credential';
import { createAnthropicModelsFetcher } from './anthropic-models.js';
import { aiConnectionTester } from './connection-test.js';
import { fireworksModelsFetcher } from './fireworks-models.js';
import { createGatewayModelsFetcher } from './gateway-models.js';
import { createOpenAiModelsFetcher } from './openai-models.js';

/** Registration must run in the HTTP process, beside `registerLinkTitles`. */
export function registerAiConnectionTester(): { close: () => void } {
  setAiConnectionTester(aiConnectionTester);
  setAiModelsFetcher((kind, key) => {
    const fetchers = {
      anthropic: createAnthropicModelsFetcher,
      openai: createOpenAiModelsFetcher,
      gateway: createGatewayModelsFetcher,
    };
    return kind === 'fireworks'
      ? fireworksModelsFetcher(key)
      : fetchers[kind](globalThis.fetch)(key);
  });
  return {
    close: () => {
      setAiConnectionTester(undefined);
      setAiModelsFetcher(undefined);
    },
  };
}
