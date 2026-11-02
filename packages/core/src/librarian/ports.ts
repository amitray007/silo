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
