import type { LibrarianRequest } from '@silo/core/ai-credential';

export { librarianPersona as persona, promptVersion } from '@silo/core';
export function requestContext(request: LibrarianRequest): string {
  const last = request.messages.findLast((message) => message.role === 'user');
  return JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    link: request.link,
    ...(request.ownerAction ? { ownerAction: request.ownerAction } : {}),
    selection: last?.metadata ?? null,
  });
}
