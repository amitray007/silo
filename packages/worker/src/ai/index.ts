import { setAiConnectionTester, setAiModelsFetcher } from '@silo/core/ai-credential';
import { aiConnectionTester } from './connection-test.js';
import { fireworksModelsFetcher } from './fireworks-models.js';

/** Registration must run in the HTTP process, beside `registerLinkTitles`. */
export function registerAiConnectionTester(): { close: () => void } {
  setAiConnectionTester(aiConnectionTester);
  setAiModelsFetcher(fireworksModelsFetcher);
  return {
    close: () => {
      setAiConnectionTester(undefined);
      setAiModelsFetcher(undefined);
    },
  };
}
