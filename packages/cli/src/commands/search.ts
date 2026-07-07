import type { Client } from '../client.js';
import { dim, formatLinkLine } from '../format.js';

export type SearchOptions = {
  query: string;
  json: boolean;
};

/** `silo search <query>` — `GET /api/links/search` → a ranked, formatted result list. */
export async function runSearch(client: Client, options: SearchOptions): Promise<void> {
  const { results } = await client.search(options.query);

  if (options.json) {
    console.log(JSON.stringify({ results }));
    return;
  }

  if (results.length === 0) {
    console.log(dim(`No results for "${options.query}".`));
    return;
  }

  for (const link of results) {
    console.log(formatLinkLine(link));
  }
}
