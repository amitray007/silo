/**
 * Live eval for the `x-post-title` prompt. NOT part of CI: it calls a real
 * provider and costs money. Run it by hand before a prompt change ships:
 *
 *   SILO_EVAL_PROVIDER=anthropic SILO_EVAL_MODEL=claude-haiku-5-5 \
 *   ANTHROPIC_API_KEY=... pnpm --filter @silo/worker eval:x-titles
 *
 * Provider is `anthropic`, `openai` or `gateway`. The key comes from
 * `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY`. The model is a
 * catalog id (default: the provider's default). It prints one row per fixture
 * with the title the app would store, the prompt version, and the mechanical
 * checks. Whether a title reads well is for a person to judge from the table.
 */
import { readFileSync } from 'node:fs';
import type { AiCredential } from '@silo/core/ai-credential';

type Fixture = {
  id: string;
  source: 'real' | 'synthetic';
  authorName: string;
  authorHandle: string;
  language: string | null;
  text: string;
  threadAfter: string[];
};

const KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gateway: 'AI_GATEWAY_API_KEY',
} as const;
type Provider = keyof typeof KEY_ENV;

const EMOJI = /\p{Extended_Pictographic}|\u200d|\ufe0e|\ufe0f/u;
const SCRIPT: Record<string, RegExp> = {
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/u,
  hi: /[\u0900-\u097f]/u,
};

function fail(message: string): never {
  console.error(`eval:x-titles: ${message}`);
  process.exit(1);
}

function isProvider(value: string | undefined): value is Provider {
  return value !== undefined && Object.hasOwn(KEY_ENV, value);
}

/** The mechanical checks; returns the names of the checks that failed. */
function mechanicalFailures(title: string, language: string | null): string[] {
  const failed: string[] = [];
  if (title.length > 70) failed.push('length');
  // Japanese has no spaces, so a word count means nothing there.
  if (language !== 'ja') {
    const words = title.split(/\s+/).filter(Boolean).length;
    if (words < 3 || words > 10) failed.push('words');
  }
  if (EMOJI.test(title)) failed.push('emoji');
  if (/https?:|www\./i.test(title)) failed.push('url');
  if (title.includes('@')) failed.push('@');
  const script = language ? SCRIPT[language] : undefined;
  if (script && !script.test(title)) failed.push('script');
  return failed;
}

function cell(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ');
  const clipped = flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
  return clipped.padEnd(width);
}

async function main(): Promise<void> {
  const provider = process.env.SILO_EVAL_PROVIDER;
  if (!isProvider(provider)) {
    fail('set SILO_EVAL_PROVIDER to anthropic, openai or gateway.');
  }
  const keyEnv = KEY_ENV[provider];
  const apiKey = process.env[keyEnv]?.trim();
  if (!apiKey) fail(`set ${keyEnv} to a ${provider} API key.`);

  // @silo/core opens a lazy database pool on import. The eval never queries it.
  process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/unused';
  const { defaultModelFor, modelsForProvider } = await import('@silo/core');
  const wanted = process.env.SILO_EVAL_MODEL?.trim();
  const model = wanted
    ? modelsForProvider(provider).find((entry) => entry.id === wanted)
    : defaultModelFor(provider);
  if (!model) {
    const ids = modelsForProvider(provider).map((entry) => entry.id);
    fail(
      `SILO_EVAL_MODEL "${wanted}" is not a ${provider} model. Choose one of: ${ids.join(', ')}.`,
    );
  }

  const { runAiFeature } = await import('../../ai/run.js');
  const { languageModelFor } = await import('../../ai/model.js');
  const { xPostTitle } = await import('./index.js');
  const credential: AiCredential = { kind: provider, apiKey, model };
  const fixtures = JSON.parse(
    readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'),
  ) as Fixture[];
  const version = `v${xPostTitle.promptVersion}`;

  async function row(fixture: Fixture): Promise<{ line: string; state: 'pass' | 'fail' | 'skip' }> {
    const tag = fixture.source === 'synthetic' ? ' [synthetic]' : '';
    const post = cell(`${fixture.authorHandle}: ${fixture.text}${tag}`, 44);
    if (fixture.text.trim().length === 0) {
      const skip = cell('skipped: the worker never asks', 48);
      return { line: `${post} ${skip} ${version}   -`, state: 'skip' };
    }
    const result = await runAiFeature(
      xPostTitle,
      {
        authorName: fixture.authorName,
        authorHandle: fixture.authorHandle,
        language: fixture.language ?? undefined,
        text: fixture.text,
        thread: fixture.threadAfter,
      },
      {
        isFeatureOn: async () => true,
        credential: async () => credential,
        model: languageModelFor,
      },
    );
    const title = result.ok ? result.value : `(no title: ${result.code})`;
    const failures = result.ok ? mechanicalFailures(title, fixture.language) : ['no title'];
    const verdict = failures.length === 0 ? 'pass' : `FAIL ${failures.join(',')}`;
    return {
      line: `${post} ${cell(title, 48)} ${version}   ${verdict}`,
      state: failures.length === 0 ? 'pass' : 'fail',
    };
  }

  console.log(
    `x-post-title prompt ${version} - ${provider} / ${model.id} - ${fixtures.length} posts\n`,
  );
  console.log(`${cell('post', 44)} ${cell('title', 48)} ver  checks`);
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const fixture of fixtures) {
    const { line, state } = await row(fixture);
    console.log(line);
    counts[state] += 1;
  }
  console.log(
    `\n${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skipped. Read the titles yourself: the checks are mechanical.`,
  );
  process.exit(counts.fail > 0 ? 1 : 0);
}

await main();
