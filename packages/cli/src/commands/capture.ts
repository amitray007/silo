import type { Client } from '../client.js';
import { bold, dim, statusBadge } from '../format.js';
import type { LinkJson } from '../types.js';

export type CaptureOptions = {
  url: string;
  note?: string;
  tags: string[];
  wait: boolean;
  json: boolean;
};

/** Polls `GET /api/links/:id` (every 500ms, up to 10s) until `captureStatus` leaves `enriching` — used by `capture --wait`. Returns the last-seen link either way (a still-`enriching` link after the timeout is not an error, just unresolved — the caller reports it as such). */
async function waitForEnrichment(client: Client, id: string): Promise<LinkJson> {
  const deadline = Date.now() + 10_000;
  let link = (await client.getById(id)).link;
  while (link.captureStatus === 'enriching' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    link = (await client.getById(id)).link;
  }
  return link;
}

function printLink(link: LinkJson, deduped: boolean): void {
  const label = deduped ? dim('already saved (folded)') : statusBadge(link.captureStatus);
  console.log(`${bold(link.title ?? link.url)}  ${label}`);
  console.log(dim(link.url));
  if (link.tags.length > 0) console.log(dim(`tags: ${link.tags.join(', ')}`));
}

/**
 * `silo capture <url>` — `POST /api/links`. Returns immediately after the
 * 201 by default (enrichment is silo's quiet backend job — mirrors the
 * extension philosophy per the plan); `--wait` polls until it settles and
 * prints the enriched result instead.
 */
export async function runCapture(client: Client, options: CaptureOptions): Promise<void> {
  const body: { url: string; note?: string; tags?: string[] } = { url: options.url };
  if (options.note !== undefined) body.note = options.note;
  if (options.tags.length > 0) body.tags = options.tags;

  const result = await client.capture(body);
  let link = result.link;

  if (options.wait && !result.deduped && link.captureStatus === 'enriching') {
    link = await waitForEnrichment(client, link.id);
  }

  if (options.json) {
    console.log(JSON.stringify({ link, deduped: result.deduped }));
    return;
  }

  printLink(link, result.deduped);
}
