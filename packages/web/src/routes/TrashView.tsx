import { ComingSoon, ContentHeader } from '../components';

/**
 * `/trash` — restore/delete-now/empty land in a later slice (V3-5). For now,
 * a static "Trash" header (v3's trash-count meta needs the trash list API's
 * shape, not yet wired here) over the stub `ComingSoon` body.
 */
export function TrashView() {
  return (
    <>
      <ContentHeader title="Trash" />
      <div className="silo-content-body">
        <div className="silo-content-col">
          <ComingSoon title="Trash — coming soon" subtitle="Deleted links will appear here." />
        </div>
      </div>
    </>
  );
}
