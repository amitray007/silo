import type { QueryClient } from '@tanstack/react-query';

const versions = new WeakMap<QueryClient, Map<string, number>>();

export function readerPrefsVersion(client: QueryClient, id: string): number {
  return versions.get(client)?.get(id) ?? 0;
}

/** Advances both on local edits and on write completion, excluding GETs started during either. */
export function advanceReaderPrefsVersion(client: QueryClient, id: string): void {
  let entries = versions.get(client);
  if (!entries) {
    entries = new Map();
    versions.set(client, entries);
  }
  entries.set(id, readerPrefsVersion(client, id) + 1);
}
