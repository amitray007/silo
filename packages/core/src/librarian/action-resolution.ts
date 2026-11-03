import { getSetting } from '../settings/settings.js';
import {
  ARTICLE_ACTION_IDS,
  LIBRARY_ACTION_IDS,
  type LibrarianActionKind,
  type OwnerAction,
  PASSAGE_ACTION_IDS,
} from './actions.js';
import { type LibrarianMessage, librarianMessageSchema } from './types.js';

export async function resolveLibrarianAction(
  kind: LibrarianActionKind,
  id: string,
): Promise<OwnerAction | undefined> {
  if (!id.startsWith('custom:')) return undefined;
  const actions = await getSetting('librarianActions');
  const entry = actions[kind].find((action) => action.id === id);
  return entry && 'prompt' in entry ? { label: entry.label, prompt: entry.prompt } : undefined;
}

export async function resolveAction(kind: LibrarianActionKind, id?: string) {
  const ownerAction = id ? await resolveLibrarianAction(kind, id) : undefined;
  const builtins: readonly string[] = {
    passage: PASSAGE_ACTION_IDS,
    article: ARTICLE_ACTION_IDS,
    library: LIBRARY_ACTION_IDS,
  }[kind];
  return {
    valid: id === undefined || builtins.includes(id) || ownerAction !== undefined,
    ownerAction,
  };
}

export async function resolveMessageAction(messages: LibrarianMessage[], linkId: string | null) {
  const last = messages.findLast((message) => message.role === 'user');
  const parsed = librarianMessageSchema.safeParse(last);
  const metadata = parsed.success ? parsed.data.metadata : undefined;
  const kind = metadata?.quote !== undefined ? 'passage' : linkId ? 'article' : 'library';
  return resolveAction(kind, metadata?.action);
}
