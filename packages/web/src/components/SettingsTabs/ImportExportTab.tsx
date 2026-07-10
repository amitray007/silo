import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, apiPost, apiUrl } from '../../api/client';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided } from './rowStyles';

type ExportFormat = 'json' | 'yaml' | 'csv';

/**
 * Web's own mirror of `@silo/core`'s `ImportResult` (`packages/core/src/links/import.ts`)
 * — NOT imported from `@silo/core` (the bundling rule, `docs/rules/web-react.md`:
 * core's barrel value-imports `@silo/db` -> `pg` at module top level). `version`
 * is always `1` server-side but kept as `number` here since the wire contract
 * (JSON) doesn't carry the literal-type narrowing.
 */
type ImportResult = {
  version: number;
  total: number;
  created: number;
  merged: number;
  skipped: { index: number; url?: string; reason: string }[];
};

/** The Import row's outcome — `null` before any file has been picked. Mirrors the three cases the route/client contract distinguishes: a parse-side rejection (bad JSON, never reached the server), a typed API failure (401/400/other), or a successful `ImportResult`. */
type ImportState =
  | { kind: 'parse-error'; message: string }
  | { kind: 'api-error'; message: string }
  | { kind: 'result'; result: ImportResult }
  | null;

const EXPORT_FORMAT_OPTIONS = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'csv', label: 'CSV' },
] as const satisfies ReadonlyArray<{ value: ExportFormat; label: string }>;

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4.5 6.5 3.5 3 3.5-3" />
    </svg>
  );
}

/**
 * The Export row's format picker — mirrors `PreferencesTab`'s
 * `TrashPurgeDropdown` structure/classes/a11y exactly (same
 * `silo-settings-select-*` classes, `role="listbox"`, Escape-to-close,
 * outside-pointerdown-to-close). Unlike the purge dropdown, this selection is
 * transient UI state only — it is NOT persisted to `/api/settings` (export
 * format is a per-download choice, not a setting).
 */
function ExportFormatDropdown({
  value,
  onChange,
}: {
  value: ExportFormat;
  onChange: (value: ExportFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const listboxId = useId();
  const selectedLabel =
    EXPORT_FORMAT_OPTIONS.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function selectValue(nextValue: ExportFormat) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <span ref={rootRef} className="silo-settings-select-wrap">
      <button
        type="button"
        className="silo-settings-select-trigger"
        aria-label="Export format"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <span>{selectedLabel}</span>
        <span aria-hidden="true" className="silo-settings-select-chevron">
          <ChevronDownIcon />
        </span>
      </button>
      {open && (
        <div id={listboxId} role="listbox" className="silo-settings-select-menu">
          {EXPORT_FORMAT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="silo-settings-select-option"
              onClick={() => selectValue(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <span aria-hidden="true" className="silo-settings-select-check">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Builds the `/api/export` URL for the given format — factored out of the click handler so it's directly testable without simulating an anchor click. */
export function exportUrl(format: ExportFormat): string {
  return apiUrl(`/api/export?format=${format}`);
}

/**
 * Triggers a browser download of the export at `format` via a throwaway
 * anchor (`href` + `download`, appended/clicked/removed) rather than
 * `window.location.assign` — this way the current Settings modal stays open
 * and no navigation occurs; the server's `Content-Disposition: attachment`
 * (see `packages/api/src/routes/export.ts`) is what actually makes the
 * browser download rather than navigate.
 */
function downloadExport(format: ExportFormat): void {
  const anchor = document.createElement('a');
  anchor.href = exportUrl(format);
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * Renders an `ImportState` as a calm, `rowDesc`-styled line under the Import
 * row — success summary, or one of the three error messages (parse/401/other).
 * `skipped` reasons (when present) are tucked into a `<details>` rather than
 * inlined, so a large skip list doesn't blow out the row's rhythm.
 */
function ImportStatusLine({ state }: { state: ImportState }) {
  if (state === null) return null;

  if (state.kind === 'parse-error' || state.kind === 'api-error') {
    return (
      <p style={{ ...rowDesc, marginTop: 6 }} role="alert">
        {state.message}
      </p>
    );
  }

  const { result } = state;
  return (
    <div style={{ ...rowDesc, marginTop: 6 }}>
      Imported {result.total} — {result.created} new, {result.merged} merged
      {result.skipped.length > 0 && (
        <>
          {' · '}
          <details style={{ display: 'inline' }}>
            <summary
              style={{ display: 'inline', cursor: 'pointer' }}
              title={result.skipped
                .map((s) => `#${s.index}${s.url ? ` ${s.url}` : ''}: ${s.reason}`)
                .join('\n')}
            >
              {result.skipped.length} skipped
            </summary>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {result.skipped.map((s) => (
                <li key={s.index}>
                  #{s.index}
                  {s.url ? ` ${s.url}` : ''} — {s.reason}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

/**
 * Settings → Import + Export (v3's `tabImport`): both halves are now LIVE.
 * Export (plan 027, Unit 4) is a format picker (JSON/YAML/CSV, JSON default)
 * plus a Download button hitting `GET /api/export?format=<selected>`
 * (`packages/core/src/links/export.ts` → `packages/api/src/routes/export.ts`).
 * Import (plan 028, Unit 3) picks a local silo-export JSON file, parses it
 * client-side, and POSTs it to `POST /api/import` (`packages/api/src/routes/import.ts`)
 * via the shared `apiPost` client. That route is token-gated the same way
 * ingest is — until the web-auth slice gives the client a bearer token, a real
 * POST here 401s; that's surfaced as an honest inline message rather than
 * hidden behind a disabled control, since the flow itself (pick → parse →
 * POST → summarize) is fully built and curl-testable today.
 */
export function ImportExportTab() {
  const [format, setFormat] = useState<ExportFormat>('json');
  const [importState, setImportState] = useState<ImportState>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input's value immediately so re-selecting the SAME file still
    // fires a fresh `change` event next time (a browser suppresses `change`
    // when the `<input>`'s value/FileList would be unchanged).
    event.target.value = '';
    if (!file) return;

    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      setImportState({ kind: 'parse-error', message: "That file isn't valid JSON." });
      return;
    }

    try {
      const result = await apiPost<ImportResult>('/api/import', parsed);
      setImportState({ kind: 'result', result });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setImportState({
          kind: 'api-error',
          message:
            "Import needs a server token (it accepts source data, so it's gated like ingest). The auth setup will wire this up.",
        });
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        setImportState({
          kind: 'api-error',
          message: error.message || "That file isn't a valid silo export.",
        });
        return;
      }
      setImportState({ kind: 'api-error', message: 'Import failed — try again.' });
    }
  }

  return (
    <>
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Import</div>
          <div style={rowDesc}>A silo export (JSON)</div>
          <ImportStatusLine state={importState} />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
        <button
          type="button"
          className="silo-settings-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          Choose file…
        </button>
      </div>
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Export</div>
          <div style={rowDesc}>
            Your whole library — JSON or YAML (full backup) or CSV (flat list)
          </div>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ExportFormatDropdown value={format} onChange={setFormat} />
          <button
            type="button"
            className="silo-settings-btn"
            onClick={() => downloadExport(format)}
          >
            Download
          </button>
        </span>
      </div>
    </>
  );
}
