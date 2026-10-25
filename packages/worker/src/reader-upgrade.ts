import { findReaderUpgradeCandidates, getById, recordReaderUpgrade } from '@silo/core';
import { extract } from './extract/extract.js';
import { safeFetch } from './fetch/safe-fetch.js';

export type ReaderUpgradeOutcome = 'upgraded' | 'unchanged' | 'unavailable';

type ReaderUpgradeOptions = { refreshHtml?: boolean };

/** A separate capture path: never calls enrichLink, changes status or trashes. */
export async function upgradeReader(
  linkId: string,
  deps = { safeFetch, extract },
  options: ReaderUpgradeOptions = {},
): Promise<ReaderUpgradeOutcome> {
  const link = await getById(linkId);
  if (!link || (!options.refreshHtml && link.contentHtml !== null && link.extractedText))
    return 'unchanged';
  const result = await deps.safeFetch(link.url);
  if (!result.ok) return 'unavailable';
  const extracted = await deps.extract({
    url: result.finalUrl,
    html: result.html,
    contentType: result.contentType,
  });
  if (!extracted.reader) return 'unavailable';
  return (await recordReaderUpgrade(linkId, extracted.reader, extracted.text, options.refreshHtml))
    ? 'upgraded'
    : 'unchanged';
}

/** Sequential pages. Default mode resumes; explicit refresh revisits all live Reader HTML. */
export async function runReaderUpgrade(
  report: (linkId: string, outcome: ReaderUpgradeOutcome) => void = () => {},
  options: ReaderUpgradeOptions = {},
): Promise<Record<ReaderUpgradeOutcome, number>> {
  const counts = { upgraded: 0, unchanged: 0, unavailable: 0 };
  let afterId: string | undefined;
  for (;;) {
    const candidates = await findReaderUpgradeCandidates(afterId, options.refreshHtml);
    if (candidates.length === 0) return counts;
    for (const candidate of candidates) {
      const outcome = await upgradeReader(candidate.id, undefined, options);
      counts[outcome]++;
      report(candidate.id, outcome);
      afterId = candidate.id;
    }
  }
}
