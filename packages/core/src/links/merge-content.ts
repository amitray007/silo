import type { Link } from './executor.js';

type CaptureFields = Pick<
  Link,
  'title' | 'titleSource' | 'description' | 'imageUrl' | 'siteName' | 'extractedText'
>;

/** Re-saving adds captured values; absent fields never erase stored content. */
export function mergeCaptureFields(
  existing: CaptureFields,
  incoming: { [K in keyof CaptureFields]?: CaptureFields[K] | undefined },
) {
  return {
    title: incoming.title ?? existing.title,
    titleSource: incoming.titleSource ?? existing.titleSource,
    description: incoming.description ?? existing.description,
    imageUrl: incoming.imageUrl ?? existing.imageUrl,
    siteName: incoming.siteName ?? existing.siteName,
    extractedText: incoming.extractedText ?? existing.extractedText,
  };
}

const statusRank = { enriching: 0, bare: 1, partial: 2, full: 3 } as const;

/** Keep the best captured content, including a protected in-flight enrichment floor. */
export function bestCaptureStatus(...statuses: (Link['captureStatus'] | null)[]) {
  return statuses.reduce<Link['captureStatus']>(
    (best, status) => (status && statusRank[status] > statusRank[best] ? status : best),
    'enriching',
  );
}
