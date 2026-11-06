import { getSettings } from '../lib/settings.js';

type Page = { url: string; html: string; capturedAt: string };
type Entry = Page & { linkId: string; attempts: number };
const ALARM = 'silo-page-outbox';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('silo-page-outbox', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('pages', { keyPath: ['linkId', 'capturedAt'] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open page outbox'));
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('pages', mode);
      const request = run(tx.objectStore('pages'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(new Error('Page outbox transaction failed'));
      tx.onabort = () => reject(new Error('Page outbox transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export function readPage(tabId: number | undefined, url: string): Promise<Page | undefined> {
  if (tabId === undefined) return Promise.resolve(undefined);
  return chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [0] },
      func: () => {
        const html = document.documentElement.outerHTML;
        if (new TextEncoder().encode(html).byteLength > 8 * 1024 * 1024) return undefined;
        return { url: location.href, html, capturedAt: new Date().toISOString() };
      },
    })
    .then((results) => {
      const page = results[0]?.result;
      return page?.url === url ? page : undefined;
    })
    .catch(() => undefined);
}

export async function queuePage(linkId: string, page: Page): Promise<void> {
  await transact('readwrite', (store) =>
    store.put({ ...page, linkId, attempts: 0 } satisfies Entry),
  );
  await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
  await retryPages();
}
let running: Promise<void> | undefined;
export function retryPages(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  if (!running)
    running = drain().finally(() => {
      running = undefined;
    });
  return running;
}
async function drain(): Promise<void> {
  const entries = await transact<Entry[]>('readonly', (store) => store.getAll());
  if (entries.length) await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
  for (const entry of entries) await upload(entry);
  const remaining = await transact<number>('readonly', (store) => store.count());
  if (!remaining) await chrome.alarms.clear(ALARM);
}
async function upload(entry: Entry): Promise<void> {
  if (entry.attempts >= 5 || Date.now() - Date.parse(entry.capturedAt) > 7 * 86400_000) {
    await transact('readwrite', (store) => store.delete([entry.linkId, entry.capturedAt]));
    return;
  }
  // Persist the attempt before network I/O so worker termination cannot reset the budget.
  await transact('readwrite', (store) => store.put({ ...entry, attempts: entry.attempts + 1 }));
  try {
    const settings = await getSettings();
    const response = await fetch(`${settings.baseUrl}/api/links/${entry.linkId}/page`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
      },
      body: JSON.stringify({ url: entry.url, html: entry.html, capturedAt: entry.capturedAt }),
      signal: AbortSignal.timeout(30_000),
    });
    if (
      response.ok ||
      (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status))
    ) {
      await transact('readwrite', (store) => store.delete([entry.linkId, entry.capturedAt]));
    }
  } catch {
    /* The durable entry is retried by the next alarm. */
  }
}
