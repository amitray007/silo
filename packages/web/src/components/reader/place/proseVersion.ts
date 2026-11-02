import { useSyncExternalStore } from 'react';

/** Reader-owned decorations do not change the article's text or paragraph membership. */
export const DECORATION =
  '.silo-marker, .silo-notes-layer, .silo-place-ribbon-gutter, .silo-place-ribbon-preview, .silo-pencil';

function decoration(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(DECORATION));
}

export function proseMutation(record: MutationRecord): boolean {
  if (decoration(record.target)) return false;
  if (record.type !== 'childList') return true;
  return [...record.addedNodes, ...record.removedNodes].some((node) => !decoration(node));
}

type Version = {
  read: () => number;
  subscribe: (listener: () => void) => () => void;
};
const versions = new WeakMap<HTMLElement, Version>();

function proseVersion(prose: HTMLElement): Version {
  const cached = versions.get(prose);
  if (cached) return cached;
  let version = 0;
  const listeners = new Set<() => void>();
  let notifying = false;
  const update = (records: MutationRecord[]) => {
    if (!records.some(proseMutation)) return;
    version += 1;
    if (notifying) return;
    notifying = true;
    queueMicrotask(() => {
      notifying = false;
      for (const listener of listeners) listener();
    });
  };
  const observer = new MutationObserver(update);
  observer.observe(prose, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'title', 'class'],
  });
  const entry: Version = {
    read: () => {
      update(observer.takeRecords());
      return version;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  versions.set(prose, entry);
  return entry;
}

export function textVersion(prose: HTMLElement): number {
  return proseVersion(prose).read();
}

/** Re-resolve saved positions after text replacement; typography keeps the same index. */
export function useProseVersion(prose: HTMLElement): number {
  const version = proseVersion(prose);
  return useSyncExternalStore(version.subscribe, version.read);
}
