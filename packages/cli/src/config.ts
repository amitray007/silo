import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The persisted CLI config (`~/.config/silo/config.json`) — base URL +
 * bearer token, both optional. Overridable at every call site by env vars
 * and CLI flags (see `resolveConnection` below); this file is only the
 * lowest-priority layer. `$XDG_CONFIG_HOME` is honored if set (the standard
 * override), falling back to `~/.config` otherwise.
 */
export type SiloConfig = {
  baseUrl?: string;
  token?: string;
};

/** `~/.config/silo` (or `$XDG_CONFIG_HOME/silo`) — the CLI's own config dir, also home to the ingest seen-set files (`ingest/state.ts`). */
export function configDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const base =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : join(homedir(), '.config');
  return join(base, 'silo');
}

/** The config file path — `configDir()/config.json`. */
export function configFilePath(): string {
  return join(configDir(), 'config.json');
}

/**
 * Reads the persisted config, returning `{}` if the file doesn't exist yet
 * (a fresh install with no `silo config set` run) or is malformed (a
 * corrupted/hand-edited file must not crash every other command — it just
 * means "nothing persisted", the same as a missing file).
 */
export async function readConfig(): Promise<SiloConfig> {
  try {
    const raw = await readFile(configFilePath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const obj = parsed as Record<string, unknown>;
    const config: SiloConfig = {};
    if (typeof obj.baseUrl === 'string') config.baseUrl = obj.baseUrl;
    if (typeof obj.token === 'string') config.token = obj.token;
    return config;
  } catch {
    return {};
  }
}

/** Writes `config`, creating `configDir()` first if needed. Overwrites the whole file (callers merge with `readConfig()` first — see `commands/config.ts`). */
export async function writeConfig(config: SiloConfig): Promise<void> {
  const path = configFilePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** The resolved connection settings every command uses to build a `Client`. */
export type Connection = {
  baseUrl: string;
  token: string | undefined;
};

const DEFAULT_BASE_URL = 'http://localhost:8787';

/**
 * Resolves the effective `{ baseUrl, token }` for this invocation, in
 * priority order: CLI flags (`--base-url`/`--token`) > env vars
 * (`SILO_BASE_URL`/`SILO_API_TOKEN`) > the persisted config file > the
 * built-in default base URL (`http://localhost:8787`; no default token —
 * ingest simply requires one to be configured somewhere).
 */
export async function resolveConnection(flags: {
  baseUrl?: string;
  token?: string;
}): Promise<Connection> {
  const fileConfig = await readConfig();
  const baseUrl =
    flags.baseUrl ?? process.env.SILO_BASE_URL ?? fileConfig.baseUrl ?? DEFAULT_BASE_URL;
  const token = flags.token ?? process.env.SILO_API_TOKEN ?? fileConfig.token;
  return { baseUrl, token };
}
