import { configFilePath, readConfig, writeConfig } from '../config.js';
import { dim } from '../format.js';

const KNOWN_KEYS = ['baseUrl', 'token'] as const;
type ConfigKey = (typeof KNOWN_KEYS)[number];

function isConfigKey(key: string): key is ConfigKey {
  return (KNOWN_KEYS as readonly string[]).includes(key);
}

/** Masks a token for display — the first 4 and last 4 chars only, per the plan's "never print the token back in full". A short token (<=8 chars) is fully masked rather than risk showing all of it. */
function maskToken(token: string): string {
  if (token.length <= 8) return '*'.repeat(token.length);
  return `${token.slice(0, 4)}${'*'.repeat(token.length - 8)}${token.slice(-4)}`;
}

function displayValue(key: ConfigKey, value: string): string {
  return key === 'token' ? maskToken(value) : value;
}

/** `silo config get [key]` — prints one value, or the whole (token-masked) config when no key is given. */
async function runGet(key?: string): Promise<void> {
  const config = await readConfig();

  if (key === undefined) {
    if (config.baseUrl === undefined && config.token === undefined) {
      console.log(dim(`No config set yet (${configFilePath()}).`));
      return;
    }
    for (const k of KNOWN_KEYS) {
      const value = config[k];
      if (value !== undefined) console.log(`${k} = ${displayValue(k, value)}`);
    }
    return;
  }

  if (!isConfigKey(key)) {
    throw new Error(`Unknown config key "${key}". Known keys: ${KNOWN_KEYS.join(', ')}.`);
  }
  const value = config[key];
  console.log(value === undefined ? dim('(not set)') : displayValue(key, value));
}

/** `silo config set <key> <value>` — persists one key to `~/.config/silo/config.json`, merging with whatever's already there. */
async function runSet(key: string, value: string | undefined): Promise<void> {
  if (!isConfigKey(key)) {
    throw new Error(`Unknown config key "${key}". Known keys: ${KNOWN_KEYS.join(', ')}.`);
  }
  if (value === undefined) {
    throw new Error(`Usage: silo config set ${key} <value>`);
  }

  const config = await readConfig();
  config[key] = value;
  await writeConfig(config);
  console.log(`${key} = ${displayValue(key, value)}  (saved to ${configFilePath()})`);
}

/** `silo config [get|set] ...` — read/write `~/.config/silo/config.json`. */
export async function runConfig(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (subcommand === 'get') {
    await runGet(rest[0]);
    return;
  }
  if (subcommand === 'set') {
    await runSet(rest[0] ?? '', rest[1]);
    return;
  }

  throw new Error('Usage: silo config get [key] | silo config set <key> <value>');
}
