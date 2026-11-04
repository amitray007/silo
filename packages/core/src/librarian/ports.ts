import type { OwnerAction } from './actions.js';
import type { LibrarianMessage } from './types.js';
export type LibrarianToolSource = {
  list(): Promise<{ name: string; description: string; inputSchema: Record<string, unknown> }[]>;
  call(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ text: string; structured?: unknown; isError: boolean }>;
};
export type LibrarianRequest = {
  chatId: string;
  summary?: string | null;
  summarizedCount?: number;
  messageSeqs?: number[];
  transient?: boolean;
  ownerAction?: OwnerAction;
  endRun?: () => void;
  messages: LibrarianMessage[];
  link: { id: string; title: string | null; url: string; site: string | null } | null;
  abortSignal?: AbortSignal | undefined;
};
export type LibrarianRunner = (request: LibrarianRequest) => Promise<Response>;
let runner: LibrarianRunner | undefined;
let source: LibrarianToolSource | undefined;
export function setLibrarianRunner(value: LibrarianRunner | undefined): void {
  runner = value;
}
export function setLibrarianToolSource(value: LibrarianToolSource | undefined): void {
  source = value;
}
export function getLibrarianRunner(): LibrarianRunner | undefined {
  return runner;
}
export function getLibrarianToolSource(): LibrarianToolSource | undefined {
  return source;
}

const activeRuns = new Map<string, symbol>();
export function beginLibrarianRun(chatId: string): (() => void) | undefined {
  if (activeRuns.has(chatId)) return undefined;
  const token = Symbol();
  activeRuns.set(chatId, token);
  const timer = setTimeout(release, 5 * 60 * 1000);
  timer.unref();
  function release() {
    clearTimeout(timer);
    if (activeRuns.get(chatId) === token) activeRuns.delete(chatId);
  }
  return release;
}

export type Suggestions = { kind: 'ask' | 'do'; text: string }[];
/** Resolves to null when the model call failed: a failure is retried later, never stored. */
let suggestionsRunner:
  | ((question: string, answer: string) => Promise<Suggestions | null>)
  | undefined;
export function setLibrarianSuggestionsRunner(value: typeof suggestionsRunner) {
  suggestionsRunner = value;
}
export function getLibrarianSuggestionsRunner() {
  return suggestionsRunner;
}
