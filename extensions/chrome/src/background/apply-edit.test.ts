import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/capture-client.js', () => ({
  editNote: vi.fn(async () => ({})),
  addTag: vi.fn(async () => ({})),
  removeTag: vi.fn(async () => ({})),
  // Mirrors the real CaptureError's constructor (kind, message) — a bare
  // `class extends Error {}` would pass both args to `Error`, making
  // `.message` become `kind` instead of `message`.
  CaptureError: class extends Error {
    constructor(
      public readonly kind: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

describe('applyEdit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues PATCH + add + remove in order and returns ok', async () => {
    const client = await import('../lib/capture-client.js');
    const { applyEdit } = await import('./apply-edit.js');
    const res = await applyEdit('1', { note: 'hi', addedTags: ['new'], removedTags: ['old'] });
    expect(res).toEqual({ ok: true });
    expect(client.editNote).toHaveBeenCalledWith('1', 'hi');
    expect(client.addTag).toHaveBeenCalledWith('1', 'new');
    expect(client.removeTag).toHaveBeenCalledWith('1', 'old');
  });

  it('skips the PATCH when note is undefined', async () => {
    const client = await import('../lib/capture-client.js');
    const { applyEdit } = await import('./apply-edit.js');
    await applyEdit('1', { addedTags: [], removedTags: [] });
    expect(client.editNote).not.toHaveBeenCalled();
  });

  it('returns ok:false, partial:false when the FIRST call fails (nothing applied)', async () => {
    const client = await import('../lib/capture-client.js');
    (client.addTag as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new (client.CaptureError as new (k: string, m: string) => Error)('server', 'boom'),
    );
    const { applyEdit } = await import('./apply-edit.js');
    const res = await applyEdit('1', { addedTags: ['x'], removedTags: [] });
    expect(res).toEqual({ ok: false, message: 'boom', partial: false });
  });

  it('reports partial:true and an honest message when an EARLIER call already committed', async () => {
    const client = await import('../lib/capture-client.js');
    // tag 'a' succeeds and persists server-side; tag 'b' then fails.
    (client.addTag as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new (client.CaptureError as new (k: string, m: string) => Error)('server', 'boom'),
      );
    const { applyEdit } = await import('./apply-edit.js');
    const res = await applyEdit('1', { addedTags: ['a', 'b'], removedTags: [] });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.partial).toBe(true);
    expect(res.message).toContain('Some changes were saved');
    // 'a' was applied before the failure — not rolled back.
    expect(client.addTag).toHaveBeenCalledWith('1', 'a');
  });
});
