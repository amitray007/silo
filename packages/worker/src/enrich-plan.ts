/** NULL keeps the existing full pipeline; a set runs only the union of these steps. */
export function planEnrich(link: { enrichFields: readonly string[] | null; sourceKind: string }) {
  if (link.enrichFields === null) return null;
  const fields = new Set(link.enrichFields);
  const twitter = link.sourceKind === 'twitter';
  const metadata = fields.has('metadata');
  const title = fields.has('title');
  const reader = fields.has('reader');
  return {
    source: fields.has('source') || (twitter && metadata),
    writeSource: fields.has('source'),
    fetch: reader || (!twitter && (title || metadata)),
    reader,
    aiTitle: twitter && title,
    title: title || metadata,
    metadata,
  };
}
