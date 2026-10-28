import { setAiConnectionTester } from '@silo/core';
import { aiConnectionTester } from './connection-test.js';

/** Registration must run in the HTTP process, beside `registerLinkTitles`. */
export function registerAiConnectionTester(): { close: () => void } {
  setAiConnectionTester(aiConnectionTester);
  return { close: () => setAiConnectionTester(undefined) };
}
