import { useEffect, useId, useRef, useState } from 'react';
import { apiUrl } from '../../api/client';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided, tabNote } from './rowStyles';

type ExportFormat = 'json' | 'yaml' | 'csv';

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
 * Settings → Import + Export (v3's `tabImport`): the Export row is now LIVE
 * (plan 027, Unit 4) — a format picker (JSON/YAML/CSV, JSON default) plus a
 * Download button that hits `GET /api/export?format=<selected>`
 * (`packages/core/src/links/export.ts` → `packages/api/src/routes/export.ts`).
 * Import stays disabled — a separate later slice (v3 has a full choose-file →
 * preview → "Import N links" flow backed by an import API route that doesn't
 * exist yet); render that row faithfully disabled with a calm "not yet" note
 * rather than simulating a picker that has nowhere real to go.
 */
export function ImportExportTab() {
  const [format, setFormat] = useState<ExportFormat>('json');

  return (
    <>
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Import</div>
          <div style={rowDesc}>A Pocket, Instapaper, or browser-bookmarks export file</div>
        </div>
        <button type="button" disabled title="Not yet available" className="silo-settings-btn">
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
      <p style={tabNote}>Import isn't wired up yet — coming in a later slice.</p>
    </>
  );
}
