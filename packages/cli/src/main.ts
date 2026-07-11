#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Client, ClientError } from './client.js';
import { runCapture } from './commands/capture.js';
import { runConfig } from './commands/config.js';
import { runIngestX } from './commands/ingest-x.js';
import { runList } from './commands/list.js';
import { runOpen } from './commands/open.js';
import { runSearch } from './commands/search.js';
import { resolveConnection } from './config.js';
import { bold, dim, red } from './format.js';

const HELP = `${bold('silo')} — a terminal client for silo (${dim('https://github.com/amitray007/silo')})

${bold('Usage')}
  silo capture <url> [--note <text>] [--tag <t>]... [--wait]
  silo search <query>
  silo list [--tag <t>] [--limit <n>]
  silo open <id|url>
  silo ingest x [--limit <n>] [--dry-run] [--resend]
  silo config get [key] | silo config set <key> <value>

${bold('Global flags')}
  --json           Raw, pipeable JSON output (default: pretty/formatted)
  --base-url <u>   Override the API base URL (default: http://localhost:8787)
  --token <t>      Override the bearer token (for /api/ingest)
  --help, -h       Show this help

${bold('Config')}
  Resolved in priority order: flags > env (SILO_BASE_URL, SILO_API_TOKEN) >
  ~/.config/silo/config.json (silo config set baseUrl|token <value>).
`;

/** The global flags every subcommand shares — parsed once, stripped from `positionals` before the subcommand's own arg parsing runs. */
const GLOBAL_OPTIONS = {
  json: { type: 'boolean' as const, default: false },
  'base-url': { type: 'string' as const },
  token: { type: 'string' as const },
  help: { type: 'boolean' as const, short: 'h', default: false },
};

const SUBCOMMAND_OPTIONS = {
  note: { type: 'string' as const },
  tag: { type: 'string' as const, multiple: true as const },
  wait: { type: 'boolean' as const, default: false },
  limit: { type: 'string' as const },
  'dry-run': { type: 'boolean' as const, default: false },
  // `--resend`'s alias, `--force`: `parseArgs` has no native alias support,
  // so both are declared and OR'd together in `handleIngest`.
  resend: { type: 'boolean' as const, default: false },
  force: { type: 'boolean' as const, default: false },
};

function parseInvocationArgs() {
  return parseArgs({
    args: process.argv.slice(2),
    options: { ...GLOBAL_OPTIONS, ...SUBCOMMAND_OPTIONS },
    allowPositionals: true,
    strict: false,
  });
}

/** The parsed CLI invocation — everything a subcommand handler needs, already resolved (connection, positionals, flag values). Building this once in `main` (rather than re-parsing per-case) is what keeps each `case` in `dispatch` a short, single-purpose call. `globals`'s type is DERIVED from `parseInvocationArgs`'s actual return (not hand-declared) — `strict: false` widens every option's value to include `string` (an unrecognized flag parses as a string), so a hand-written type here would drift from what `parseArgs` really returns. */
type Invocation = {
  command: string;
  rest: string[];
  globals: ReturnType<typeof parseInvocationArgs>['values'];
  client: Client;
  connection: Awaited<ReturnType<typeof resolveConnection>>;
  json: boolean;
};

async function handleCapture(inv: Invocation): Promise<void> {
  const url = inv.rest[0];
  if (!url) throw new Error('Usage: silo capture <url> [--note <text>] [--tag <t>]... [--wait]');
  const options: Parameters<typeof runCapture>[1] = {
    url,
    tags: (inv.globals.tag as string[] | undefined) ?? [],
    wait: Boolean(inv.globals.wait),
    json: inv.json,
  };
  if (inv.globals.note !== undefined) options.note = inv.globals.note as string;
  await runCapture(inv.client, options);
}

async function handleSearch(inv: Invocation): Promise<void> {
  const query = inv.rest.join(' ');
  if (!query) throw new Error('Usage: silo search <query>');
  await runSearch(inv.client, { query, json: inv.json });
}

async function handleList(inv: Invocation): Promise<void> {
  const options: Parameters<typeof runList>[1] = { json: inv.json };
  const tag = (inv.globals.tag as string[] | undefined)?.[0];
  if (tag !== undefined) options.tag = tag;
  if (inv.globals.limit !== undefined) options.limit = Number(inv.globals.limit);
  await runList(inv.client, options);
}

async function handleOpen(inv: Invocation): Promise<void> {
  const target = inv.rest[0];
  if (!target) throw new Error('Usage: silo open <id|url>');
  await runOpen(inv.client, target);
}

/** `true` (and prints the token-required message) when `silo ingest x` cannot proceed — no token configured and not a dry run. Extracted so `handleIngest` stays a single early-return + one call. */
function ingestBlockedOnToken(inv: Invocation, dryRun: boolean): boolean {
  if (inv.connection.token || dryRun) return false;
  console.error(
    'silo ingest requires an API token. Set SILO_API_TOKEN on the API and `silo config set token <t>`.',
  );
  process.exitCode = 1;
  return true;
}

async function handleIngest(inv: Invocation): Promise<void> {
  const platform = inv.rest[0];
  if (platform !== 'x') {
    throw new Error(`Unknown ingest platform "${platform ?? ''}". Supported: x.`);
  }
  const dryRun = Boolean(inv.globals['dry-run']);
  if (ingestBlockedOnToken(inv, dryRun)) return;

  const options: Parameters<typeof runIngestX>[1] = {
    dryRun,
    json: inv.json,
    hasToken: Boolean(inv.connection.token),
    // `--force` is a plain alias for `--resend` (no native alias support in
    // `parseArgs` — see `SUBCOMMAND_OPTIONS`), so either flag being set wins.
    resend: Boolean(inv.globals.resend) || Boolean(inv.globals.force),
  };
  if (inv.globals.limit !== undefined) options.limit = Number(inv.globals.limit);
  await runIngestX(inv.client, options);
}

const HANDLERS: Record<string, (inv: Invocation) => Promise<void>> = {
  capture: handleCapture,
  search: handleSearch,
  list: handleList,
  open: handleOpen,
  ingest: handleIngest,
  config: (inv) => runConfig(inv.rest),
};

async function dispatch(inv: Invocation): Promise<void> {
  const handler = HANDLERS[inv.command];
  if (!handler) {
    throw new Error(`Unknown command "${inv.command}". Run \`silo --help\` for usage.`);
  }
  await handler(inv);
}

async function main(): Promise<void> {
  const { values: globals, positionals } = parseInvocationArgs();
  const [command, ...rest] = positionals;

  if (globals.help || command === undefined) {
    console.log(HELP);
    return;
  }

  const flags: { baseUrl?: string; token?: string } = {};
  if (globals['base-url'] !== undefined) flags.baseUrl = globals['base-url'] as string;
  if (globals.token !== undefined) flags.token = globals.token as string;
  const connection = await resolveConnection(flags);

  await dispatch({
    command,
    rest,
    globals,
    client: new Client(connection),
    connection,
    json: Boolean(globals.json),
  });
}

main().catch((error: unknown) => {
  if (error instanceof ClientError) {
    console.error(red(error.message));
    if (error.hint) console.error(dim(error.hint));
  } else if (error instanceof Error) {
    console.error(red(error.message));
  } else {
    console.error(red('An unknown error occurred.'));
  }
  process.exitCode = 1;
});
