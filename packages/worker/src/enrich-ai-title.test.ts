import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { MockLanguageModelV4 } from 'ai/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiError, credential, failingModel, okResult } from './ai/test-helpers.js';
import type { EnrichLinkDeps } from './enrich.js';
import { xPostTitle } from './enrich-source/twitter-title/index.js';
import type { SafeFetchResult } from './fetch/safe-fetch.js';

/**
 * `enrichLink` + the `x-post-title` AI feature, against a real Postgres. The
 * model is a mock: the real runner (`runAiFeature`) runs with injected gate,
 * credential and model, so the gate, schema, sanitizer and failure paths are real.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const plugins = {
  hacker_news: { enabled: true, inline: true, hover: true, palette: true },
  github: { enabled: true, hover: true, palette: true },
  youtube: { enabled: true, hover: true, palette: true },
  twitter: { enabled: true, inline: true, hover: true, palette: true },
};

const okFetch = (url: string): SafeFetchResult => ({
  ok: true,
  html: '<html></html>',
  contentType: 'text/html',
  finalUrl: url,
  status: 200,
});

function post(text = 'We added a command menu to make navigating faster.') {
  return {
    kind: 'twitter' as const,
    text,
    authorHandle: 'interfere',
    authorName: 'Interfere',
    language: 'en',
    likes: 1,
    reposts: 0,
    replies: 0,
    quotes: 0,
    bookmarks: 0,
  };
}

describeIfPg('enrichLink AI titles (integration)', () => {
  let dropDatabase: () => void;
  let core: typeof import('@silo/core');
  let enrichMod: typeof import('./enrich.js');
  let runAiFeature: typeof import('./ai/run.js').runAiFeature;
  let n = 0;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_ai_title_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');
    process.env.DATABASE_URL = database.url;
    core = await import('@silo/core');
    enrichMod = await import('./enrich.js');
    ({ runAiFeature } = await import('./ai/run.js'));
  }, 60_000);

  afterAll(async () => {
    try {
      const { pool: corePool } = await import('@silo/db');
      await corePool.end();
    } catch {
      // @silo/db may never have loaded if beforeAll timed out mid-setup.
    }
    dropDatabase?.();
  }, 60_000);

  /** A model that answers with `title`, and a count of its calls. */
  function modelReturning(title: string) {
    return new MockLanguageModelV4({
      doGenerate: async () => okResult(JSON.stringify({ title })),
    });
  }

  function depsFor(
    model: MockLanguageModelV4,
    opts: { featureOn?: boolean; source?: ReturnType<typeof post>; pageTitle?: string } = {},
  ): EnrichLinkDeps {
    const featureOn = opts.featureOn ?? true;
    return {
      safeFetch: (url) => Promise.resolve(okFetch(url)),
      extract: () =>
        Promise.resolve({ status: 'full', title: opts.pageTitle ?? 'Interfere on X', text: 'x' }),
      enrichSource: () => Promise.resolve(opts.source ?? post()),
      getPluginsSetting: () => Promise.resolve(plugins),
      runXPostTitle: (input) =>
        runAiFeature(xPostTitle, input, {
          isFeatureOn: async () => featureOn,
          credential: async () => credential,
          model: () => model,
        }),
    };
  }

  async function newPost(url?: string): Promise<string> {
    n += 1;
    const link = await core.createLink({
      url: url ?? `https://x.com/interfere/status/${1000 + n}`,
      sourceKind: url ? 'link' : 'twitter',
    });
    return link.id;
  }

  it('writes the AI title with source ai', async () => {
    const id = await newPost();
    const model = modelReturning('Interfere adds a command menu');
    await enrichMod.enrichLink(id, depsFor(model));
    const link = await core.getById(id);
    expect(link?.title).toBe('Interfere adds a command menu');
    expect(link?.titleSource).toBe('ai');
    expect(link?.captureStatus).toBe('full');
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('cleans the model output before storing it', async () => {
    const id = await newPost();
    await enrichMod.enrichLink(
      id,
      depsFor(modelReturning('Title: "Interfere adds a command menu 🚀."')),
    );
    expect((await core.getById(id))?.title).toBe('Interfere adds a command menu');
  });

  it('keeps the page title when the model fails, and the job still resolves', async () => {
    const id = await newPost();
    const model = failingModel(apiError(401));
    await expect(enrichMod.enrichLink(id, depsFor(model))).resolves.toBeUndefined();
    const link = await core.getById(id);
    expect(link?.title).toBe('Interfere on X');
    expect(link?.titleSource).toBe('page');
    expect(link?.captureStatus).toBe('full');
  });

  it('keeps the page title when the model returns an unusable title', async () => {
    const id = await newPost();
    await enrichMod.enrichLink(id, depsFor(modelReturning("I can't help with that")));
    expect((await core.getById(id))?.title).toBe('Interfere on X');
  });

  it('makes no model call when the feature is off', async () => {
    const id = await newPost();
    const model = modelReturning('Never used');
    await enrichMod.enrichLink(id, depsFor(model, { featureOn: false }));
    expect(model.doGenerateCalls).toHaveLength(0);
    const link = await core.getById(id);
    expect(link?.title).toBe('Interfere on X');
    expect(link?.titleSource).toBe('page');
  });

  it('makes no call and keeps the title when the owner edited it', async () => {
    const id = await newPost();
    await core.editLink(id, { title: 'My own title' });
    const model = modelReturning('Never used');
    await enrichMod.enrichLink(id, depsFor(model), { trigger: 'manual', previousStatus: 'full' });
    expect(model.doGenerateCalls).toHaveLength(0);
    const link = await core.getById(id);
    expect(link?.title).toBe('My own title');
    expect(link?.titleSource).toBe('user');
  });

  it('a sweep keeps an existing AI title and makes no call', async () => {
    const id = await newPost();
    await core.recordEnrichment(id, { title: 'AI first', titleSource: 'ai', status: 'partial' });
    const model = modelReturning('Never used');
    await enrichMod.enrichLink(id, depsFor(model), { trigger: 'sweep', previousStatus: 'partial' });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect((await core.getById(id))?.title).toBe('AI first');
  });

  it('a capture re-run keeps an existing AI title and makes no call', async () => {
    const id = await newPost();
    await core.recordEnrichment(id, { title: 'AI first', titleSource: 'ai', status: 'full' });
    const model = modelReturning('Never used');
    await enrichMod.enrichLink(id, depsFor(model), { trigger: 'capture', previousStatus: 'full' });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect((await core.getById(id))?.title).toBe('AI first');
  });

  it('a manual run asks again and replaces an AI title', async () => {
    const id = await newPost();
    await core.recordEnrichment(id, { title: 'AI first', titleSource: 'ai', status: 'full' });
    await core.requestEnrich(id);
    const model = modelReturning('Interfere adds a command menu');
    await enrichMod.enrichLink(id, depsFor(model), { trigger: 'manual', previousStatus: 'full' });
    expect(model.doGenerateCalls).toHaveLength(1);
    const link = await core.getById(id);
    expect(link?.title).toBe('Interfere adds a command menu');
    expect(link?.titleSource).toBe('ai');
  });

  it('a capture of a page-titled post asks', async () => {
    const id = await newPost();
    const model = modelReturning('Interfere adds a command menu');
    await enrichMod.enrichLink(id, depsFor(model), {
      trigger: 'capture',
      previousStatus: 'enriching',
    });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('a sweep run of a page-titled post asks', async () => {
    const id = await newPost();
    const model = modelReturning('Interfere adds a command menu');
    await enrichMod.enrichLink(id, depsFor(model), {
      trigger: 'sweep',
      previousStatus: 'enriching',
    });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('never asks for a link that is not a twitter post', async () => {
    const id = await newPost('https://example.com/not-a-post');
    const model = modelReturning('Never used');
    await enrichMod.enrichLink(id, depsFor(model));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect((await core.getById(id))?.title).toBe('Interfere on X');
  });

  it('never asks for a post with no text', async () => {
    const id = await newPost();
    const model = modelReturning('Never used');
    await enrichMod.enrichLink(id, depsFor(model, { source: post('  ') }));
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('sends the later posts of the thread in the prompt', async () => {
    const id = await newPost();
    const model = modelReturning('Interfere adds a command menu');
    const source = {
      ...post(),
      threadAfter: [
        { id: '2', text: 'second post' },
        { id: '3', text: 'third post' },
        { id: '4', text: 'fourth post' },
      ],
    };
    await enrichMod.enrichLink(id, depsFor(model, { source }));
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain('second post');
    expect(prompt).toContain('third post');
    expect(prompt).not.toContain('fourth post');
  });

  it('writes the AI title on a held full run that comes back thin', async () => {
    const id = await newPost();
    await core.recordEnrichment(id, {
      title: 'Page title',
      text: 'x'.repeat(400),
      status: 'full',
    });
    await core.requestEnrich(id);
    const deps = depsFor(modelReturning('Interfere adds a command menu'));
    deps.extract = () => Promise.resolve({ status: 'partial', title: 'Thin title', text: 'thin' });
    await enrichMod.enrichLink(id, deps, { trigger: 'manual', previousStatus: 'full' });
    const link = await core.getById(id);
    expect(link?.captureStatus).toBe('full');
    expect(link?.title).toBe('Interfere adds a command menu');
    expect(link?.titleSource).toBe('ai');
    expect(link?.extractedText).toBe('x'.repeat(400));
  });

  it('a held full run keeps the old title when the model fails', async () => {
    const id = await newPost();
    await core.recordEnrichment(id, { title: 'Page title', text: 'x'.repeat(400), status: 'full' });
    await core.requestEnrich(id);
    const deps = depsFor(failingModel(apiError(401)));
    deps.extract = () => Promise.resolve({ status: 'partial', title: 'Thin title', text: 'thin' });
    await enrichMod.enrichLink(id, deps, { trigger: 'manual', previousStatus: 'full' });
    expect((await core.getById(id))?.title).toBe('Page title');
  });

  it('writes the AI title when the page fetch fails but the post text arrived', async () => {
    const id = await newPost();
    const deps = depsFor(modelReturning('Interfere adds a command menu'));
    deps.safeFetch = () => Promise.resolve({ ok: false, reason: 'http-error', detail: '503' });
    await enrichMod.enrichLink(id, deps);
    const link = await core.getById(id);
    expect(link?.title).toBe('Interfere adds a command menu');
    expect(link?.titleSource).toBe('ai');
  });

  it('does not wait for a model that never answers beyond the feature budget', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const id = await newPost();
      const deps = depsFor(modelReturning('unused'));
      deps.runXPostTitle = () => new Promise(() => {});
      let settled = false;
      const run = enrichMod.enrichLink(id, deps).then(() => {
        settled = true;
      });
      // The budget timer starts after the first database reads, so keep advancing.
      for (let i = 0; i < 200 && !settled; i += 1) {
        await vi.advanceTimersByTimeAsync(xPostTitle.timeoutMs);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await run;
      expect((await core.getById(id))?.title).toBe('Interfere on X');
    } finally {
      vi.useRealTimers();
    }
  });
});
