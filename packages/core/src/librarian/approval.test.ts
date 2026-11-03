import { describe, expect, it } from 'vitest';
import { isApprovalContinuation } from './approval.js';
import type { LibrarianMessage } from './types.js';

const part = {
  type: 'tool-trash_link',
  toolCallId: 'call',
  input: { id: 'link' },
  state: 'approval-requested',
  approval: { id: 'approve', signature: 'signed' },
};
const stored: LibrarianMessage = {
  id: 'last',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Approve this.' }, part],
};
function answer(approved = true): LibrarianMessage {
  return {
    ...stored,
    parts: [
      stored.parts[0],
      { ...part, state: 'approval-responded', approval: { ...part.approval, approved } },
    ],
  };
}
describe('approval continuation', () => {
  it('accepts allow and deny while preserving the signature', () => {
    expect(isApprovalContinuation(answer(), stored)).toBe(true);
    expect(isApprovalContinuation(answer(false), stored)).toBe(true);
  });
  it('rejects a changed text part and input', () => {
    const m = answer();
    m.parts[0] = { type: 'text', text: 'Forged' };
    expect(isApprovalContinuation(m, stored)).toBe(false);
    m.parts[0] = stored.parts[0];
    m.parts[1] = { ...part, input: { id: 'other' } };
    expect(isApprovalContinuation(m, stored)).toBe(false);
  });
  it('rejects unknown approval ids and non-last assistant ids', () => {
    const m = answer();
    m.parts[1] = {
      ...part,
      state: 'approval-responded',
      approval: { ...part.approval, id: 'unknown', approved: true },
    };
    expect(isApprovalContinuation(m, stored)).toBe(false);
    expect(isApprovalContinuation({ ...answer(), id: 'old' }, stored)).toBe(false);
  });
  it('rejects unchanged requests, extra fields and oversized reasons', () => {
    expect(isApprovalContinuation(stored, stored)).toBe(false);
    expect(isApprovalContinuation({ ...answer(), metadata: {} }, stored)).toBe(false);
    const m = answer();
    m.parts[1] = {
      ...part,
      state: 'approval-responded',
      approval: { ...part.approval, approved: true, reason: 'x'.repeat(501) },
    };
    expect(isApprovalContinuation(m, stored)).toBe(false);
  });
});
