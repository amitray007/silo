import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as ExportOps from './export.js';
import type * as LinksOps from './links.js';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md) — the
 * export shape depends on the full read path (`whereLive`, tag hydration),
 * which mocks can't prove. Mirrors `links.test.ts`'s harness pattern.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

/** Minimal RFC-4180 CSV row parser — enough to round-trip the escaping this suite asserts on. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/** Split a full CSV body into logical rows, respecting quoted newlines (CRLF row separator, RFC 4180). */
function splitCsvRows(body: string): string[] {
  const rows: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && char === '\r' && body[i + 1] === '\n') {
      rows.push(current);
      current = '';
      i++;
    } else {
      current += char;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

describeIfPg('exportLinks (integration)', () => {
  const harness = setupPgHarness('silo_core_export_test', () => import('./export.js'));
  let ops: typeof ExportOps;
  let linkOps: typeof LinksOps;

  beforeEach(async () => {
    ops = harness.mod();
    linkOps = await import('./links.js');
  });

  describe('empty library', () => {
    it('JSON: count 0, links []', async () => {
      const result = await ops.exportLinks({ format: 'json' });
      const parsed = JSON.parse(result.body);
      expect(parsed.count).toBe(0);
      expect(parsed.links).toEqual([]);
      expect(parsed.version).toBe(ops.EXPORT_VERSION);
      expect(result.count).toBe(0);
      expect(result.contentType).toBe('application/json');
      expect(result.extension).toBe('json');
    });

    it('CSV: BOM + header only', async () => {
      const result = await ops.exportLinks({ format: 'csv' });
      expect(result.body.startsWith('﻿')).toBe(true);
      const rows = splitCsvRows(result.body.slice(1));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toBe(
        'id,url,canonicalUrl,title,description,siteName,sourceKind,captureStatus,addedBy,notes,createdAt,updatedAt,tags',
      );
      expect(result.count).toBe(0);
      expect(result.contentType).toBe('text/csv; charset=utf-8');
      expect(result.extension).toBe('csv');
    });

    it('YAML: parses to count 0', async () => {
      const result = await ops.exportLinks({ format: 'yaml' });
      const parsed = parseYaml(result.body);
      expect(parsed.count).toBe(0);
      expect(parsed.links).toEqual([]);
      expect(result.contentType).toBe('application/yaml; charset=utf-8');
      expect(result.extension).toBe('yaml');
    });
  });

  describe('populated library', () => {
    it('exports a seeded set correctly across JSON/YAML/CSV', async () => {
      const twitterLink = await linkOps.createLink({
        url: 'https://x.com/user/status/12345',
        sourceKind: 'twitter',
        sourceData: {
          kind: 'twitter',
          text: 'a tweet',
          authorHandle: 'someone',
          authorName: 'Someone',
          likes: 1,
          reposts: 2,
          replies: 3,
          quotes: 0,
          bookmarks: 0,
        },
        tags: ['ai', 'postgres'],
        extractedText: 'a tweet extracted text body',
        origin: 'agent',
      });

      const githubLink = await linkOps.createLink({
        url: 'https://github.com/amitray007/silo',
        sourceKind: 'github',
        sourceData: { kind: 'github', stars: 10, forks: 2, issues: 1 },
        tags: ['oss'],
      });

      const messyTitleLink = await linkOps.createLink({
        url: 'https://example.com/messy-title-export',
        title: 'A "quoted", multi\nline title',
        sourceKind: 'link',
      });

      const noTagsLink = await linkOps.createLink({
        url: 'https://example.com/no-tags-export',
        title: 'No tags here',
        sourceKind: 'link',
      });

      // --- JSON ---
      const jsonResult = await ops.exportLinks({ format: 'json' });
      const jsonParsed = JSON.parse(jsonResult.body);
      expect(jsonParsed.version).toBe(1);
      expect(jsonParsed.count).toBe(4);
      expect(jsonResult.count).toBe(4);
      expect(jsonParsed.links).toHaveLength(4);

      const jsonTwitter = jsonParsed.links.find((l: { id: string }) => l.id === twitterLink.id);
      expect(jsonTwitter.sourceData).toMatchObject({
        kind: 'twitter',
        text: 'a tweet',
        authorHandle: 'someone',
        likes: 1,
      });
      expect(jsonTwitter.extractedText).toBe('a tweet extracted text body');
      expect(jsonTwitter.tags.slice().sort()).toEqual(['ai', 'postgres']);
      expect(jsonTwitter.addedBy).toBe('agent');
      expect(typeof jsonTwitter.createdAt).toBe('string');
      expect(Number.isNaN(Date.parse(jsonTwitter.createdAt))).toBe(false);

      const jsonNoTags = jsonParsed.links.find((l: { id: string }) => l.id === noTagsLink.id);
      expect(jsonNoTags.tags).toEqual([]);

      // Omitted internal lifecycle fields never appear in the exported object.
      expect(jsonTwitter).not.toHaveProperty('deletedAt');
      expect(jsonTwitter).not.toHaveProperty('searchVector');
      expect(jsonTwitter).not.toHaveProperty('enrichAttempts');

      // --- YAML ---
      const yamlResult = await ops.exportLinks({ format: 'yaml' });
      const yamlParsed = parseYaml(yamlResult.body);
      expect(yamlParsed.count).toBe(4);
      // Structurally equal to the JSON links, ignoring exportedAt (clock-dependent).
      const byId = <T extends { id: string }>(items: T[]): T[] =>
        [...items].sort((a, b) => a.id.localeCompare(b.id));
      expect(byId(yamlParsed.links)).toEqual(byId(jsonParsed.links));

      // --- CSV ---
      const csvResult = await ops.exportLinks({ format: 'csv' });
      expect(csvResult.body.startsWith('﻿')).toBe(true);
      const bodyNoBom = csvResult.body.slice(1);
      const rows = splitCsvRows(bodyNoBom);
      expect(rows[0]).toBe(
        'id,url,canonicalUrl,title,description,siteName,sourceKind,captureStatus,addedBy,notes,createdAt,updatedAt,tags',
      );
      expect(rows).toHaveLength(5); // header + 4 rows
      expect(csvResult.count).toBe(4);

      const dataRows = rows.slice(1).map(parseCsvLine);
      const messyRow = dataRows.find((cells) => cells[0] === messyTitleLink.id);
      expect(messyRow).toBeDefined();
      expect(messyRow?.[3]).toBe('A "quoted", multi\nline title');
      // No sourceData / extractedText / imageUrl columns present anywhere in the header.
      expect(rows[0]).not.toContain('sourceData');
      expect(rows[0]).not.toContain('extractedText');
      expect(rows[0]).not.toContain('imageUrl');
      expect(rows[0]?.split(',')).toHaveLength(13);

      const twitterRow = dataRows.find((cells) => cells[0] === twitterLink.id);
      expect(twitterRow?.[12]).toBe('ai; postgres');

      const githubRow = dataRows.find((cells) => cells[0] === githubLink.id);
      expect(githubRow?.[12]).toBe('oss');

      const noTagsRow = dataRows.find((cells) => cells[0] === noTagsLink.id);
      expect(noTagsRow?.[12]).toBe('');
    });
  });

  describe('CSV formula-injection guard', () => {
    it('a title/notes starting with a formula-trigger char is apostrophe-prefixed and still parses as one field', async () => {
      const link = await linkOps.createLink({
        url: 'https://example.com/formula-injection-title',
        title: '=HYPERLINK("http://evil","click")',
        notes: '+1 (also @mentions and -dashes trigger the guard)',
        sourceKind: 'link',
      });

      const csvResult = await ops.exportLinks({ format: 'csv' });
      const rows = splitCsvRows(csvResult.body.slice(1));
      const dataRows = rows.slice(1).map(parseCsvLine);
      const row = dataRows.find((cells) => cells[0] === link.id);
      expect(row).toBeDefined();

      // Guard fired: the cell's raw (unparsed-back) value starts with `'`.
      // parseCsvLine already stripped the RFC-4180 quoting/escaping, so the
      // guard's leading apostrophe is preserved verbatim in cells[3]/cells[9]
      // as a literal character — proving the guard, not just the quoting.
      expect(row?.[3]).toBe('\'=HYPERLINK("http://evil","click")');
      expect(row?.[9]).toBe("'+1 (also @mentions and -dashes trigger the guard)");

      // Still exactly one field each — the guard didn't break RFC-4180
      // field-count parsing (13 columns per the fixed CSV_COLUMNS order).
      expect(row).toHaveLength(13);
    });
  });

  describe('trashed link excluded', () => {
    it('a trashed link never appears in JSON, YAML, or CSV bodies', async () => {
      const liveOne = await linkOps.createLink({
        url: 'https://example.com/trash-exclude-live-1',
        sourceKind: 'link',
      });
      const liveTwo = await linkOps.createLink({
        url: 'https://example.com/trash-exclude-live-2',
        sourceKind: 'link',
      });
      const trashed = await linkOps.createLink({
        url: 'https://example.com/trash-exclude-trashed',
        sourceKind: 'link',
      });
      await linkOps.softDelete(trashed.id);

      const jsonResult = await ops.exportLinks({ format: 'json' });
      const jsonParsed = JSON.parse(jsonResult.body);
      const jsonUrls = jsonParsed.links.map((l: { url: string }) => l.url);
      expect(jsonUrls).toContain(liveOne.url);
      expect(jsonUrls).toContain(liveTwo.url);
      expect(jsonUrls).not.toContain(trashed.url);

      const yamlResult = await ops.exportLinks({ format: 'yaml' });
      expect(yamlResult.body).not.toContain(trashed.url);
      expect(yamlResult.body).toContain(liveOne.url);

      const csvResult = await ops.exportLinks({ format: 'csv' });
      expect(csvResult.body).not.toContain(trashed.url);
      expect(csvResult.body).toContain(liveOne.url);
    });
  });

  describe('sourceData null', () => {
    it('a plain link with no sourceData exports with sourceData: null present (not omitted)', async () => {
      // `core.createLink` always writes a `{ kind: 'link' }` floor into
      // `sourceData` (see `links.ts`'s `resolveSource` doc comment) — there is
      // no way to reach a genuinely NULL `source_data` column through it. The
      // column itself IS nullable (no DB default — see
      // `packages/db/src/schema/links.ts`), e.g. for pre-plan-012 rows created
      // before that floor existed. Insert directly via the harness's
      // `rawDb()` (a raw drizzle handle wired to THIS suite's disposable
      // database — see `pg-harness.ts`'s doc comment) rather than the
      // `@silo/db` singleton `db`. `links` (the table schema) is imported
      // dynamically here too, NOT as a static top-of-file import: even a
      // static import of ONLY the schema object still evaluates `@silo/db`'s
      // single `index.ts` module graph (which also constructs the `db`/`pool`
      // singleton in `client.ts` as a side effect) before `beforeAll` rewrites
      // `DATABASE_URL` for the disposable database — poisoning that singleton
      // for every OTHER module in this test run that later does
      // `import { db } from '@silo/db'` (including `exportLinks` itself),
      // which silently redirects reads/writes at the real dev database
      // instead of the disposable one. This is exactly the footgun
      // `pg-harness.ts`'s own doc comment warns every caller off of.
      const { links } = await import('@silo/db');
      const [inserted] = await harness
        .rawDb()
        .insert(links)
        .values({
          url: 'https://example.com/no-source-data',
          canonicalUrl: 'https://example.com/no-source-data',
          sourceKind: 'link',
          sourceData: null,
        })
        .returning({ id: links.id });
      if (!inserted) throw new Error('insert did not return a row');

      const jsonResult = await ops.exportLinks({ format: 'json' });
      const jsonParsed = JSON.parse(jsonResult.body);
      const jsonLink = jsonParsed.links.find((l: { id: string }) => l.id === inserted.id);
      expect(jsonLink).toBeDefined();
      expect(jsonLink).toHaveProperty('sourceData');
      expect(jsonLink.sourceData).toBeNull();
    });
  });

  describe('invalid format', () => {
    it('throws InvalidExportFormatError for an unrecognized format', async () => {
      await expect(ops.exportLinks({ format: 'xml' as ExportOps.ExportFormat })).rejects.toThrow(
        ops.InvalidExportFormatError,
      );
    });
  });
});
