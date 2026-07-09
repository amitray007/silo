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
      expect(result.contentType).toBe('text/csv');
      expect(result.extension).toBe('csv');
    });

    it('YAML: parses to count 0', async () => {
      const result = await ops.exportLinks({ format: 'yaml' });
      const parsed = parseYaml(result.body);
      expect(parsed.count).toBe(0);
      expect(parsed.links).toEqual([]);
      expect(result.contentType).toBe('application/yaml');
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

  describe('invalid format', () => {
    it('throws InvalidExportFormatError for an unrecognized format', async () => {
      await expect(ops.exportLinks({ format: 'xml' as ExportOps.ExportFormat })).rejects.toThrow(
        ops.InvalidExportFormatError,
      );
    });
  });
});
