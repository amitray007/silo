import { ComingSoon, ContentHeader } from '../components';

/** `/settings` — the tabbed settings modal (plugins/preferences/import-export/access) lands later. */
export function SettingsView() {
  return (
    <>
      <ContentHeader title="Settings" />
      <div className="silo-content-body">
        <div className="silo-content-col">
          <ComingSoon title="Settings — coming soon" subtitle="Preferences will live here." />
        </div>
      </div>
    </>
  );
}
