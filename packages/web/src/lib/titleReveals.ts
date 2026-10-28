const TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 256;

type PendingReveal = {
  kind: 'pending';
  baselineTitle: string | undefined;
  allowInitialReveal: boolean;
  visible: boolean;
  expiresAt: number;
};
type TitleEdit = { kind: 'edit'; expiresAt: number };
type Entry = PendingReveal | TitleEdit;

// Only local mutations create entries. Reads never retain a visited link id.
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const mountedRows = new Set<{ id: string; title: string }>();

export function mountTitleRow(id: string, title: string) {
  const row = { id, title };
  mountedRows.add(row);
  return () => {
    mountedRows.delete(row);
  };
}

export function mountedTitleBaselines() {
  return new Map(Array.from(mountedRows, ({ id, title }) => [id, title]));
}

function prune() {
  const now = Date.now();
  for (const [id, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(id);
  }
}

function put(id: string, entry: Entry) {
  prune();
  entries.delete(id);
  entries.set(id, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  for (const notify of listeners) notify();
}

export function subscribeTitleReveals(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function getTitleReveal(id: string) {
  prune();
  return entries.get(id);
}

export function registerTitleReveal(
  id: string,
  baselineTitle: string | undefined,
  allowInitialReveal = false,
) {
  const entry: PendingReveal = {
    kind: 'pending',
    baselineTitle,
    allowInitialReveal,
    visible: false,
    expiresAt: Date.now() + TTL_MS,
  };
  put(id, entry);
  return entry;
}

export function clearTitleReveal(id: string, expected?: Entry) {
  prune();
  if (expected && entries.get(id) !== expected) return;
  if (entries.delete(id)) for (const notify of listeners) notify();
}

export function restoreTitleReveal(id: string, expected: Entry, previous: Entry | undefined) {
  if (getTitleReveal(id) !== expected) return;
  if (previous && previous.expiresAt > Date.now()) put(id, previous);
  else clearTitleReveal(id, expected);
}

export function markTitleEdited(id: string) {
  put(id, { kind: 'edit', expiresAt: Date.now() + TTL_MS });
}

export function transferTitleReveal(
  tempId: string,
  id: string,
  baselineTitle: string,
  handoff = true,
) {
  const temporary = getTitleReveal(tempId);
  const visible = temporary?.kind === 'pending' && temporary.visible;
  clearTitleReveal(tempId);
  // An edit made during the capture request wins over its late response.
  if (getTitleReveal(id)?.kind !== 'edit')
    registerTitleReveal(id, baselineTitle, visible && handoff);
}
