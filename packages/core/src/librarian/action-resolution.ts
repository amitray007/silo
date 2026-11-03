import { getSetting } from '../settings/settings.js';
import type { LibrarianActionKind, OwnerAction } from './actions.js';
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

export async function resolveMessageAction(messages: LibrarianMessage[]) {
  const last = messages.findLast((message) => message.role === 'user');
  const parsed = librarianMessageSchema.safeParse(last);
  const metadata = parsed.success ? parsed.data.metadata : undefined;
  const id = metadata?.action;
  const custom = id?.startsWith('custom:') ?? false;
  const ownerAction =
    custom && id
      ? await resolveLibrarianAction(metadata?.quote !== undefined ? 'passage' : 'article', id)
      : undefined;
  return { custom, ownerAction };
}
