import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../config.js';
import { runConfig } from './config.js';

describe('runConfig', () => {
  let dir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'silo-cli-config-cmd-'));
    process.env.XDG_CONFIG_HOME = dir;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    await rm(dir, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('set persists a key, get reads it back', async () => {
    await runConfig(['set', 'baseUrl', 'http://example.test']);
    expect(await readConfig()).toEqual({ baseUrl: 'http://example.test' });

    logSpy.mockClear();
    await runConfig(['get', 'baseUrl']);
    expect(logSpy).toHaveBeenCalledWith('http://example.test');
  });

  it('never prints the token back in full', async () => {
    await runConfig(['set', 'token', 'abcdefghijklmnop']);

    logSpy.mockClear();
    await runConfig(['get', 'token']);

    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).not.toContain('abcdefghijklmnop');
    expect(printed).toContain('abcd');
    expect(printed).toContain('mnop');
  });

  it('fully masks a short token rather than partially exposing it', async () => {
    await runConfig(['set', 'token', 'short']);

    logSpy.mockClear();
    await runConfig(['get', 'token']);

    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).not.toContain('short');
  });

  it('get with no key prints every set value, masking the token', async () => {
    await runConfig(['set', 'baseUrl', 'http://example.test']);
    await runConfig(['set', 'token', 'abcdefghijklmnop']);

    logSpy.mockClear();
    await runConfig(['get']);

    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('http://example.test');
    expect(printed).not.toContain('abcdefghijklmnop');
  });

  it('rejects an unknown key', async () => {
    await expect(runConfig(['set', 'nonsense', 'x'])).rejects.toThrow(/Unknown config key/);
  });

  it('rejects an unknown subcommand', async () => {
    await expect(runConfig(['frobnicate'])).rejects.toThrow(/Usage:/);
  });

  it('set without a value is an error', async () => {
    await expect(runConfig(['set', 'baseUrl'])).rejects.toThrow(/Usage:/);
  });
});
