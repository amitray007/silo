import { describe, expect, it } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { enrichGitHub } from './github.js';

function okResult(body: unknown): SafeFetchResult {
  return {
    ok: true,
    html: JSON.stringify(body),
    contentType: 'application/json',
    finalUrl: 'https://api.github.com/repos/vercel/next.js',
    status: 200,
  };
}

describe('enrichGitHub', () => {
  it('maps a valid repo response to github SourceData', async () => {
    const result = await enrichGitHub('vercel', 'next.js', () =>
      Promise.resolve(
        okResult({
          stargazers_count: 120000,
          forks_count: 26000,
          open_issues_count: 3000,
          description: 'The React Framework',
          language: 'JavaScript',
        }),
      ),
    );
    expect(result).toEqual({
      kind: 'github',
      stars: 120000,
      forks: 26000,
      issues: 3000,
      description: 'The React Framework',
      language: 'JavaScript',
    });
  });

  it('omits description/language when GitHub returns them as null', async () => {
    const result = await enrichGitHub('owner', 'repo', () =>
      Promise.resolve(
        okResult({
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 0,
          description: null,
          language: null,
        }),
      ),
    );
    expect(result).toEqual({ kind: 'github', stars: 0, forks: 0, issues: 0 });
  });

  it('omits an empty-string description rather than passing it through (schema requires min 1)', async () => {
    const result = await enrichGitHub('owner', 'repo', () =>
      Promise.resolve(
        okResult({
          stargazers_count: 1,
          forks_count: 1,
          open_issues_count: 1,
          description: '',
        }),
      ),
    );
    expect(result).toEqual({ kind: 'github', stars: 1, forks: 1, issues: 1 });
  });

  it('degrades to undefined on a 404 (private/renamed/deleted repo)', async () => {
    const result = await enrichGitHub('owner', 'gone', () =>
      Promise.resolve({ ok: false, reason: 'http-error', detail: '404' }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on rate-limit (mapped as an http-error by safeFetch)', async () => {
    const result = await enrichGitHub('owner', 'repo', () =>
      Promise.resolve({ ok: false, reason: 'http-error', detail: '403' }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on timeout', async () => {
    const result = await enrichGitHub('owner', 'repo', () =>
      Promise.resolve({ ok: false, reason: 'timeout' }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on malformed JSON', async () => {
    const result = await enrichGitHub('owner', 'repo', () =>
      Promise.resolve({
        ok: true,
        html: '{not valid',
        contentType: 'application/json',
        finalUrl: 'https://api.github.com/repos/owner/repo',
        status: 200,
      }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined when required numeric fields are missing', async () => {
    const result = await enrichGitHub('owner', 'repo', () =>
      Promise.resolve(okResult({ description: 'x' })),
    );
    expect(result).toBeUndefined();
  });

  it('URL-encodes owner/repo into the request path', async () => {
    let calledUrl: string | undefined;
    await enrichGitHub('some owner', 'some/repo', (url) => {
      calledUrl = url;
      return Promise.resolve(
        okResult({ stargazers_count: 0, forks_count: 0, open_issues_count: 0 }),
      );
    });
    expect(calledUrl).toBe('https://api.github.com/repos/some%20owner/some%2Frepo');
  });
});
