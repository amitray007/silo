/**
 * Fills the views that plain ingest leaves empty: highlights in the reader,
 * subscribed feeds, and Librarian chats. Runs after enrichment settles and
 * writes a manifest of ids that `capture.mjs` needs to open those views.
 *
 * The Librarian only shows when an AI provider is ready. The screenshot run
 * has no real provider, so it stores a placeholder key and a one-model list.
 * The seeded chats never call a model.
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { HERO_HIGHLIGHTS, HERO_URL, SEED_CHATS, SEED_FEEDS, SHOT_URLS } from './seed-data.js';

export interface ShowcaseContext {
  pool: Pool;
  baseUrl: string;
  token: string;
}

export interface Manifest {
  heroLinkId: string | null;
  shotLinkIds: Record<keyof typeof SHOT_URLS, string | null>;
  heroChatId: string | null;
  feedId: string | null;
}

const SHOWCASE_MODEL = {
  id: 'claude-sonnet-5-5',
  label: 'Claude Sonnet 5.5',
  structuredOutput: 'native',
  reasoning: { type: 'anthropic' },
};

async function api(ctx: ShowcaseContext, method: string, path: string, body?: unknown) {
  const response = await fetch(`${ctx.baseUrl}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) console.warn(`[showcase] ${method} ${path} -> ${response.status} ${text}`);
  return { ok: response.ok, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function linkIdFor(pool: Pool, url: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from links where url = $1 and deleted_at is null limit 1`,
    [url],
  );
  return rows[0]?.id ?? null;
}

async function shotLinkIds(pool: Pool): Promise<Manifest['shotLinkIds']> {
  const entries = await Promise.all(
    Object.entries(SHOT_URLS).map(async ([name, url]) => [name, await linkIdFor(pool, url)]),
  );
  return Object.fromEntries(entries) as Manifest['shotLinkIds'];
}

async function seedHighlights(ctx: ShowcaseContext, linkId: string): Promise<void> {
  for (const highlight of HERO_HIGHLIGHTS) {
    const { ok } = await api(ctx, 'POST', `/links/${linkId}/highlights`, highlight);
    if (ok) console.log(`[showcase] highlight (${highlight.color}) added`);
  }
}

async function seedFeeds(ctx: ShowcaseContext): Promise<string | null> {
  let firstId: string | null = null;
  for (const url of SEED_FEEDS) {
    const { ok, json } = await api(ctx, 'POST', '/feeds', { url, syncRecents: true });
    const feed = json.feed as { id?: string } | undefined;
    if (ok && feed?.id) firstId ??= feed.id;
  }
  return firstId;
}

async function enableLibrarian(ctx: ShowcaseContext): Promise<boolean> {
  const saved = await api(ctx, 'PUT', '/ai/providers/anthropic', {
    apiKey: 'sk-ant-screenshot-placeholder-0000',
  });
  if (!saved.ok) return false;
  await ctx.pool.query(
    `update ai_providers set models = $1::jsonb, models_fetched_at = now(), last_test_ok = true,
       last_test_at = now(), last_test_code = null where kind = 'anthropic'`,
    [JSON.stringify([SHOWCASE_MODEL])],
  );
  const model = { provider: 'anthropic', id: SHOWCASE_MODEL.id };
  const patched = await api(ctx, 'PATCH', '/settings', {
    ai: {
      enabled: true,
      features: {
        librarian: { enabled: true, model },
        'x-post-title': { enabled: false, model: null },
      },
    },
  });
  return patched.ok;
}

async function seedChats(pool: Pool, linkId: string | null): Promise<string | null> {
  let heroChatId: string | null = null;
  for (const chat of SEED_CHATS) {
    const chatId = randomUUID();
    const at = `now() - interval '${chat.ageHours} hours'`;
    await pool.query(
      `insert into librarian_chats (id, link_id, title, created_at, updated_at)
       values ($1, $2, $3, ${at}, ${at})`,
      [chatId, chat.hero ? linkId : null, chat.title],
    );
    for (const [seq, message] of chat.messages.entries()) {
      await pool.query(
        `insert into librarian_messages (id, chat_id, seq, role, parts, created_at)
         values ($1, $2, $3, $4, $5::jsonb, ${at})`,
        [
          randomUUID(),
          chatId,
          seq,
          message.role,
          JSON.stringify([{ type: 'text', text: message.text }]),
        ],
      );
    }
    if (chat.hero) heroChatId = chatId;
  }
  return heroChatId;
}

export async function seedShowcase(ctx: ShowcaseContext, manifestPath: string): Promise<void> {
  const linkId = await linkIdFor(ctx.pool, HERO_URL);
  if (linkId) await seedHighlights(ctx, linkId);
  else console.warn('[showcase] hero link missing; skipping highlights');

  const feedId = await seedFeeds(ctx);
  const librarian = await enableLibrarian(ctx);
  const heroChatId = librarian ? await seedChats(ctx.pool, linkId) : null;
  if (!librarian) console.warn('[showcase] Librarian not enabled; skipping chats');

  const manifest: Manifest = {
    heroLinkId: linkId,
    shotLinkIds: await shotLinkIds(ctx.pool),
    heroChatId,
    feedId,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[showcase] manifest -> ${manifestPath}`, manifest);
}
