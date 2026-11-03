import type { QueryClient } from '@tanstack/react-query';
import { mergeDeep } from '../lib/readerSync';
import type { SettingsMap, UpdateSettingsRequest } from './types';

export const settingsQueryKey = ['settings'] as const;
export type AiSettingsChange = (current: SettingsMap['ai']) => SettingsMap['ai'];
export type SettingsUpdate = Omit<UpdateSettingsRequest, 'ai'> & {
  ai?: SettingsMap['ai'] | AiSettingsChange;
};

function request(patch: SettingsUpdate, current: SettingsMap | undefined): UpdateSettingsRequest {
  const { ai, ...rest } = patch;
  if (typeof ai !== 'function') return { ...rest, ...(ai ? { ai } : {}) };
  if (!current) throw new Error('Settings have not loaded');
  return { ...rest, ai: ai(current.ai) };
}

function apply(current: SettingsMap, patch: SettingsUpdate): SettingsMap {
  const { reader, ...rest } = request(patch, current);
  return {
    ...current,
    ...rest,
    ...(reader && current.reader ? { reader: mergeDeep(current.reader, reader) } : {}),
  };
}

function createQueue(client: QueryClient) {
  let confirmed: SettingsMap | undefined;
  const pending: SettingsUpdate[] = [];
  const projected = () => confirmed && pending.reduce(apply, confirmed);
  const publish = () => {
    const next = projected();
    if (next) client.setQueryData(settingsQueryKey, next);
  };
  return {
    enqueue(patch: SettingsUpdate) {
      if (pending.length === 0) confirmed = client.getQueryData<SettingsMap>(settingsQueryKey);
      pending.push(patch);
      publish();
    },
    request: (patch: SettingsUpdate) => request(patch, confirmed),
    settle(patch: SettingsUpdate, saved?: SettingsMap) {
      if (saved) confirmed = saved;
      const index = pending.indexOf(patch);
      if (index !== -1) pending.splice(index, 1);
      publish();
    },
    // A newly mounted tab can refetch while a save is pending. Keep the queued choices visible.
    overlay: (loaded: SettingsMap) => (pending.length > 0 ? (projected() ?? loaded) : loaded),
    isPending: () => pending.length > 0,
  };
}

const queues = new WeakMap<QueryClient, ReturnType<typeof createQueue>>();
export function settingsWriteQueue(client: QueryClient) {
  let queue = queues.get(client);
  if (!queue) {
    queue = createQueue(client);
    queues.set(client, queue);
  }
  return queue;
}
