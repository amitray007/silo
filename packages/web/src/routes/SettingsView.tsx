import { useEffect } from 'react';
import { ContentHeader } from '../components';
import { useSettings } from '../components/SettingsContext';

/**
 * `/settings` — keeps the route linkable/bookmarkable (per the build brief:
 * "the sidebar Settings button opens the modal … /settings route also opens
 * it … so it stays linkable"), but v3's Settings is a MODAL, not a screen —
 * so visiting this route just opens the shared `SettingsModal` (rendered by
 * `AppFrame`) on mount rather than rendering tabs inline. The route body is a
 * calm EMPTY content area — the modal IS the settings surface (v3's Settings
 * is a pure overlay), so the backdrop must not show stale "coming soon" chrome
 * that peeks above the modal and contradicts the working modal.
 *
 * Opening on mount + closing on unmount ties the modal's lifetime to THIS
 * route (review fix, ce-julik-frontend-races): navigating away from
 * `/settings` (e.g. clicking a Library/Trash nav link while Settings is open)
 * unmounts this view, whose cleanup closes the modal — so it never floats
 * over another route's content, matching how the mobile drawer dismisses on
 * navigation. Doing it here (unmount) rather than in a route-diffing effect
 * up in `SettingsLayer` avoids racing the open path: the sidebar's Settings
 * button flips `open` AND navigates in one batch, so a route-diff effect
 * could observe `open=true` with the pre-navigation path and close the modal
 * it was just asked to open.
 */
export function SettingsView() {
  const { openSettings, closeSettings } = useSettings();

  useEffect(() => {
    openSettings();
    // `openSettings`/`closeSettings` are stable callbacks (`useCallback` with
    // `[]` deps in SettingsContext), so listing them here doesn't cause a
    // re-run beyond mount/unmount. The cleanup closes the modal when this
    // route unmounts (navigating away) — see the class doc comment.
    return () => closeSettings();
  }, [openSettings, closeSettings]);

  return (
    <>
      <ContentHeader title="Settings" />
      {/* Empty backdrop — the SettingsModal (opened on mount) is the surface. */}
      <div className="silo-content-body" />
    </>
  );
}
