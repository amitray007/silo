import { useSyncExternalStore } from 'react';

type Passage = { quote: string; paragraph: number };
export type SelectionRequest = { passage?: Passage; question?: string; chatId?: string };
const requests = new Map<string, SelectionRequest>();
const listeners = new Set<() => void>();
export function requestDock(linkId: string, request: SelectionRequest) {
  requests.set(linkId, request);
  for (const notify of listeners) notify();
}
export function clearDockRequest(linkId: string) {
  requests.delete(linkId);
  for (const notify of listeners) notify();
}
export function useDockRequest(linkId: string) {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => requests.get(linkId),
  );
}
export const selectionActions = (quote: string) =>
  !/\s/.test(quote) && quote.length <= 32
    ? ([
        ['define', 'Define'],
        ['context', 'In context'],
        ['related', 'Related'],
      ] as const)
    : ([
        ['explain', 'Explain'],
        ['simplify', 'Simplify'],
        ['counterpoint', 'Counterpoint'],
      ] as const);
