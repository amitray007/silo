import { spawn } from 'node:child_process';
import type { Client } from '../client.js';

/** Looks like a raw URL rather than a silo link id — a `<scheme>://` prefix, distinguishing `silo open https://...` from `silo open <id>`. */
function looksLikeUrl(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `GET /api/links/:id` requires a full UUID (`packages/api/src/routes/links.ts`'s `idParamSchema`) — there's no server-side prefix-lookup endpoint. `silo list`/`silo search` print a truncated 8-char id for display, so a user pasting that shortened id back in gets a clear, actionable message instead of a raw 400. */
function assertFullId(input: string): void {
  if (!UUID_RE.test(input)) {
    throw new Error(
      `"${input}" isn't a full link id (or a URL). Copy the FULL id with --json, e.g. \`silo search <query> --json\`.`,
    );
  }
}

/** The platform opener command + args for a given `process.platform` — `open` (macOS), `start` (Windows, via `cmd`), `xdg-open` (Linux/other). No dependency: every platform ships one of these. */
function openerFor(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', ''] };
  return { command: 'xdg-open', args: [] };
}

/** Spawns the platform opener detached, so the CLI doesn't block waiting on the browser process. Rejects with an actionable message if the opener binary itself isn't found (e.g. `xdg-open` missing on a minimal Linux install). */
function spawnOpener(url: string): Promise<void> {
  const { command, args } = openerFor(process.platform);
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args, url], { stdio: 'ignore', detached: true });
    child.on('error', (cause) => {
      reject(
        new Error(
          `Could not launch "${command}" to open ${url}: ${cause.message}. Is it installed and on PATH?`,
        ),
      );
    });
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** `silo open <id|url>` — opens a silo link (looked up by id) or a raw url in the default browser. */
export async function runOpen(client: Client, target: string): Promise<void> {
  if (looksLikeUrl(target)) {
    await spawnOpener(target);
    return;
  }

  assertFullId(target);
  const { link } = await client.getById(target);
  await spawnOpener(link.url);
}
