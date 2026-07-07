import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../client.js';
import { runOpen } from './open.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const VALID_ID = '11111111-1111-1111-1111-111111111111';

function fakeChildProcess(): EventEmitter & { unref: () => void } {
  const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
  emitter.unref = vi.fn();
  return emitter;
}

describe('runOpen', () => {
  afterEach(async () => {
    const { spawn } = await import('node:child_process');
    vi.mocked(spawn).mockReset();
  });

  it('spawns the opener directly for a raw URL, without looking up a link', async () => {
    const { spawn } = await import('node:child_process');
    const child = fakeChildProcess();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as never;
    });
    const getById = vi.fn();
    const client = { getById } as unknown as Client;

    await runOpen(client, 'https://example.com/post');

    expect(getById).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
  });

  it('looks up a full-uuid id and opens its url', async () => {
    const { spawn } = await import('node:child_process');
    const child = fakeChildProcess();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as never;
    });
    const getById = vi.fn().mockResolvedValue({
      link: { id: VALID_ID, url: 'https://example.com/looked-up' },
    });
    const client = { getById } as unknown as Client;

    await runOpen(client, VALID_ID);

    expect(getById).toHaveBeenCalledWith(VALID_ID);
    const args = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];
    expect(args).toContain('https://example.com/looked-up');
  });

  it('rejects a short/truncated id with an actionable message instead of hitting the API', async () => {
    const getById = vi.fn();
    const client = { getById } as unknown as Client;

    await expect(runOpen(client, '11111111')).rejects.toThrow(/full link id/);
    expect(getById).not.toHaveBeenCalled();
  });

  it('surfaces an actionable error when the opener binary is missing', async () => {
    const { spawn } = await import('node:child_process');
    const child = fakeChildProcess();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child as never;
    });
    const client = {} as unknown as Client;

    await expect(runOpen(client, 'https://example.com')).rejects.toThrow(/Could not launch/);
  });
});
