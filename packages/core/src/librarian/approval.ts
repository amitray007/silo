import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { LibrarianMessage } from './types.js';

const record = z.record(z.string(), z.unknown());
const response = z
  .object({ id: z.string(), approved: z.boolean(), reason: z.string().max(500).optional() })
  .passthrough();

export function isApprovalContinuation(
  message: LibrarianMessage,
  stored: LibrarianMessage | undefined,
): boolean {
  if (stored?.role !== 'assistant' || message.role !== 'assistant' || message.id !== stored.id)
    return false;
  if (
    !isDeepStrictEqual({ ...message, parts: [] }, { ...stored, parts: [] }) ||
    message.parts.length !== stored.parts.length
  )
    return false;
  let changed = false;
  const valid = message.parts.every((part, index) => {
    const original = stored.parts[index];
    if (isDeepStrictEqual(part, original)) return true;
    const before = record.safeParse(original);
    const after = record.safeParse(part);
    if (!before.success || !after.success) return false;
    const a = before.data;
    const b = after.data;
    if (
      typeof a.type !== 'string' ||
      !(a.type.startsWith('tool-') || a.type === 'dynamic-tool') ||
      a.state !== 'approval-requested' ||
      b.state !== 'approval-responded'
    )
      return false;
    const approval = response.safeParse(b.approval);
    const previous = record.safeParse(a.approval);
    if (!approval.success || !previous.success || approval.data.id !== previous.data.id)
      return false;
    const { approved: _approved, reason: _reason, ...unchanged } = approval.data;
    if (!isDeepStrictEqual(unchanged, previous.data)) return false;
    changed = true;
    return isDeepStrictEqual({ ...b, state: a.state, approval: a.approval }, a);
  });
  return valid && changed;
}
