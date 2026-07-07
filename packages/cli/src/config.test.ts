import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configDir, configFilePath, readConfig, resolveConnection, writeConfig } from './config.js';

describe('config paths', () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  it('honors XDG_CONFIG_HOME when set', () => {
    process.env.XDG_CONFIG_HOME = '/custom/config';
    expect(configDir()).toBe('/custom/config/silo');
    expect(configFilePath()).toBe('/custom/config/silo/config.json');
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(configDir()).toMatch(/\.config\/silo$/);
  });
});

describe('readConfig / writeConfig', () => {
  let dir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'silo-cli-config-'));
    process.env.XDG_CONFIG_HOME = dir;
  });

  afterEach(async () => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    await rm(dir, { recursive: true, force: true });
  });

  it('returns {} when no config file exists yet', async () => {
    expect(await readConfig()).toEqual({});
  });

  it('round-trips a written config', async () => {
    await writeConfig({ baseUrl: 'http://example.test', token: 'abc' });
    expect(await readConfig()).toEqual({ baseUrl: 'http://example.test', token: 'abc' });
  });

  it('returns {} for a malformed config file rather than throwing', async () => {
    await writeConfig({ baseUrl: 'http://example.test' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(configFilePath(), 'not json{{{', 'utf8');

    expect(await readConfig()).toEqual({});
  });

  it('ignores non-string fields in a hand-edited config file', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(configFilePath()), { recursive: true });
    await writeFile(configFilePath(), JSON.stringify({ baseUrl: 123, token: null }), 'utf8');

    expect(await readConfig()).toEqual({});
  });
});

describe('resolveConnection', () => {
  let dir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalBaseUrl = process.env.SILO_BASE_URL;
  const originalToken = process.env.SILO_API_TOKEN;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'silo-cli-config-'));
    process.env.XDG_CONFIG_HOME = dir;
    delete process.env.SILO_BASE_URL;
    delete process.env.SILO_API_TOKEN;
  });

  afterEach(async () => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalBaseUrl === undefined) delete process.env.SILO_BASE_URL;
    else process.env.SILO_BASE_URL = originalBaseUrl;
    if (originalToken === undefined) delete process.env.SILO_API_TOKEN;
    else process.env.SILO_API_TOKEN = originalToken;
    await rm(dir, { recursive: true, force: true });
  });

  it('defaults to localhost:8787 with no token when nothing is configured', async () => {
    expect(await resolveConnection({})).toEqual({
      baseUrl: 'http://localhost:8787',
      token: undefined,
    });
  });

  it('prefers the config file over the default', async () => {
    await writeConfig({ baseUrl: 'http://file.test', token: 'file-token' });
    expect(await resolveConnection({})).toEqual({
      baseUrl: 'http://file.test',
      token: 'file-token',
    });
  });

  it('prefers env vars over the config file', async () => {
    await writeConfig({ baseUrl: 'http://file.test', token: 'file-token' });
    process.env.SILO_BASE_URL = 'http://env.test';
    process.env.SILO_API_TOKEN = 'env-token';
    expect(await resolveConnection({})).toEqual({ baseUrl: 'http://env.test', token: 'env-token' });
  });

  it('prefers flags over everything', async () => {
    await writeConfig({ baseUrl: 'http://file.test', token: 'file-token' });
    process.env.SILO_BASE_URL = 'http://env.test';
    process.env.SILO_API_TOKEN = 'env-token';
    expect(await resolveConnection({ baseUrl: 'http://flag.test', token: 'flag-token' })).toEqual({
      baseUrl: 'http://flag.test',
      token: 'flag-token',
    });
  });
});
