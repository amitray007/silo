import { db, links } from '@silo/db';
import { desc } from 'drizzle-orm';
import { stringify as stringifyYaml } from 'yaml';
import type { Link } from './executor.js';
import { whereLive } from './live.js';
import { hydrateTags, type LinkWithTags } from './pagination.js';

/** The three export output formats (design spec: full-library snapshot). */
export type ExportFormat = 'json' | 'yaml' | 'csv';

/** The serialized result of `exportLinks` — ready to write to a response/file as-is. */
export type ExportResult = {
  format: ExportFormat;
  contentType: string;
  extension: string;
  count: number;
  body: string;
};

/**
 * Export schema version — a future importer gates on this to know which shape
 * it's reading. Bump whenever the exported object's field set changes.
 */
export const EXPORT_VERSION = 1;

/** Thrown when `exportLinks` is asked for a format outside `ExportFormat`. */
export class InvalidExportFormatError extends Error {
  constructor(format: string) {
    super(`invalid export format: "${format}"`);
    this.name = 'InvalidExportFormatError';
  }
}

const VALID_FORMATS: ReadonlySet<string> = new Set<ExportFormat>(['json', 'yaml', 'csv']);

/** The exported per-link object shape — the single source of truth every serializer maps from. */
type ExportedLink = {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  sourceKind: string;
  sourceData: Record<string, unknown> | null;
  extractedText: string | null;
  captureStatus: Link['captureStatus'];
  addedBy: Link['addedBy'];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
};

/**
 * The shared row -> export-object mapper (design spec, method file U1 step 4):
 * ONE function every serializer (JSON/YAML/CSV) maps through, so the three
 * formats can never drift on which fields exist. Whitelists exactly the
 * fields a backup/agent-feed cares about; deliberately OMITS internal
 * lifecycle columns (`deletedAt`, `searchVector`, `enrichAttempts`) — not
 * user data worth round-tripping. Timestamps render as ISO strings.
 */
function toExportedLink(link: LinkWithTags): ExportedLink {
  return {
    id: link.id,
    url: link.url,
    canonicalUrl: link.canonicalUrl,
    title: link.title,
    description: link.description,
    imageUrl: link.imageUrl,
    siteName: link.siteName,
    sourceKind: link.sourceKind,
    sourceData: link.sourceData,
    extractedText: link.extractedText,
    captureStatus: link.captureStatus,
    addedBy: link.addedBy,
    notes: link.notes,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    tags: link.tags,
  };
}

/** The JSON/YAML envelope both lossless formats share. */
type ExportEnvelope = {
  version: number;
  exportedAt: string;
  count: number;
  links: ExportedLink[];
};

function toJson(envelope: ExportEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

function toYaml(envelope: ExportEnvelope): string {
  return stringifyYaml(envelope);
}

/** Fixed CSV column order (design spec) — the flat, partial shared-columns view. */
const CSV_COLUMNS = [
  'id',
  'url',
  'canonicalUrl',
  'title',
  'description',
  'siteName',
  'sourceKind',
  'captureStatus',
  'addedBy',
  'notes',
  'createdAt',
  'updatedAt',
  'tags',
] as const;

/** UTF-8 BOM so Excel opens the CSV as UTF-8 rather than guessing a legacy codepage. */
const UTF8_BOM = '﻿';

/**
 * Characters that spreadsheet apps (Excel, Google Sheets, LibreOffice) treat
 * as a formula trigger when they are the FIRST character of a cell.
 */
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

/**
 * CSV/"formula injection" guard (OWASP:
 * https://owasp.org/www-community/attacks/CSV_Injection). silo captures
 * arbitrary web page titles and tweet text verbatim from third-party sites —
 * an attacker-influenced value like `=HYPERLINK("http://evil","click")`
 * saved as a link's title would become a LIVE, auto-executing formula the
 * moment this CSV is opened in Excel/Sheets, not inert text. Neutralize it by
 * prefixing a single apostrophe when the cell's first character is one of
 * `=`, `+`, `-`, `@`, tab, or CR — the standard OWASP-recommended guard.
 * Spreadsheet apps render a leading `'` as "this is text" and strip it from
 * the displayed value, so this is invisible to a human opening the file
 * while defusing the formula for every affected app.
 */
function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

/**
 * RFC 4180 field escaping: wrap in double quotes (doubling any internal
 * quote) when the value contains a comma, quote, or newline (`\n`/`\r`).
 * `null`/`undefined` render as an empty cell. Formula-injection neutralizing
 * (`neutralizeFormula`) runs FIRST, so the RFC-4180 quoting decision below
 * always operates on the already-guarded value.
 */
function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const guarded = neutralizeFormula(value);
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function toCsv(exportedLinks: ExportedLink[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = exportedLinks.map((link) => {
    const cells: Record<(typeof CSV_COLUMNS)[number], string> = {
      id: link.id,
      url: link.url,
      canonicalUrl: link.canonicalUrl,
      title: link.title ?? '',
      description: link.description ?? '',
      siteName: link.siteName ?? '',
      sourceKind: link.sourceKind,
      captureStatus: link.captureStatus,
      addedBy: link.addedBy,
      notes: link.notes ?? '',
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      tags: link.tags.join('; '),
    };
    return CSV_COLUMNS.map((column) => escapeCsvCell(cells[column])).join(',');
  });
  return UTF8_BOM + [header, ...rows].join('\r\n');
}

/**
 * Export the full live library (trash excluded) as a JSON, YAML, or CSV
 * snapshot — the design spec's backup + feed-to-AI use case. Formats stay in
 * lock-step because every serializer maps through the single `toExportedLink`
 * whitelist (see its doc comment). One query, ordered `(createdAt, id)` DESC
 * (same ordering `list()`'s full-dump would use), then batched tag hydration
 * via `hydrateTags` — no N+1, no new query pattern, no pagination (export is
 * the whole library at once, per the design spec's explicit out-of-scope on
 * streaming at current scale).
 *
 * MEMORY NOTE (deferred-streaming decision, recorded not solved): this
 * buffers the entire live library (rows + full `extractedText`) into ONE
 * in-memory string — no pagination/streaming, per the design spec's explicit
 * out-of-scope at current single-user scale. Safe to ~a few thousand small
 * links; a library with many multi-MB `extractedText` rows can approach V8's
 * ~512MB string limit. When that becomes real, add keyset-paged streaming
 * (see `pagination.ts`'s `MAX_LIMIT`/`MAX_OFFSET` for the ceiling pattern) —
 * do NOT silently cap or truncate rows here instead: a truncated backup is
 * worse than the memory risk.
 */
export async function exportLinks(opts?: { format?: ExportFormat }): Promise<ExportResult> {
  const format = opts?.format ?? 'json';
  if (!VALID_FORMATS.has(format)) {
    throw new InvalidExportFormatError(format);
  }

  const rows = await db
    .select()
    .from(links)
    .where(whereLive())
    .orderBy(desc(links.createdAt), desc(links.id));
  const hydrated = await hydrateTags(db, rows);
  const exportedLinks = hydrated.map(toExportedLink);

  if (format === 'csv') {
    return {
      format,
      contentType: 'text/csv; charset=utf-8',
      extension: 'csv',
      count: exportedLinks.length,
      body: toCsv(exportedLinks),
    };
  }

  const envelope: ExportEnvelope = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    count: exportedLinks.length,
    links: exportedLinks,
  };

  if (format === 'yaml') {
    return {
      format,
      contentType: 'application/yaml; charset=utf-8',
      extension: 'yaml',
      count: exportedLinks.length,
      body: toYaml(envelope),
    };
  }

  return {
    format,
    contentType: 'application/json',
    extension: 'json',
    count: exportedLinks.length,
    body: toJson(envelope),
  };
}
