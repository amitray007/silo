import type { ReaderExtraction } from '@silo/core';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';

export function paywallDeclared(document: Document): boolean {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const pending: unknown[] = [JSON.parse(script.textContent ?? '')];
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object') continue;
        if (
          'isAccessibleForFree' in value &&
          (value.isAccessibleForFree === false || value.isAccessibleForFree === 'false')
        )
          return true;
        pending.push(...Object.values(value));
      }
    } catch {
      // Malformed publisher markup supplies no access signal.
    }
  }
  return false;
}

export function blockedFetch(result: SafeFetchResult): boolean {
  return (
    !result.ok &&
    result.reason === 'http-error' &&
    ([401, 403, 429].includes(result.status ?? 0) ||
      (result.status === 503 && result.responseHeaders?.['cf-mitigated'] === 'challenge'))
  );
}

export function withReaderAccess(
  result: ReaderExtraction,
  source: SafeFetchResult | { access?: 'paywalled' | 'blocked' },
): ReaderExtraction {
  const access = 'ok' in source ? (blockedFetch(source) ? 'blocked' : undefined) : source.access;
  if (access === 'blocked') return { status: 'fetch_failed', access };
  return access && result.status !== 'fetch_failed' ? { ...result, access } : result;
}
