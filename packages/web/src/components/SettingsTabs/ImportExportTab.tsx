import { rowDesc, rowLabel, settingsRow, settingsRowDivided, tabNote } from './rowStyles';

/**
 * Settings → Import + Export (v3's `tabImport`): v3 has a full choose-file →
 * preview → "Import N links" flow plus a JSON export download, both backed
 * by import/export API routes that don't exist yet (this slice's brief:
 * render the rows faithfully, disabled, with a calm "not yet" note — don't
 * build a fake file-picker flow). So this renders the same two rows
 * (Import/Export) with disabled buttons and an explanatory note instead of
 * simulating a picker or a preview list that has nowhere real to go.
 */
export function ImportExportTab() {
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
          <div style={rowDesc}>Everything as JSON — links, full text, notes, tags</div>
        </div>
        <button type="button" disabled title="Not yet available" className="silo-settings-btn">
          Download
        </button>
      </div>
      <p style={tabNote}>Import and export aren't wired up yet — coming in a later slice.</p>
    </>
  );
}
