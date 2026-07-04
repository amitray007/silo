import { Route, Routes } from 'react-router-dom';
import { AppFrame } from './components';
import { LibraryView } from './routes/LibraryView';
import { NotFoundView } from './routes/NotFoundView';
import { SettingsView } from './routes/SettingsView';
import { TagView } from './routes/TagView';
import { TrashView } from './routes/TrashView';

/**
 * The real route table (W5): `AppFrame` is the layout route (renders the
 * sidebar + an `<Outlet/>`) wrapping each content view. Views are thin
 * `ComingSoon` wrappers for now — the list/capture/edit screens land one at a
 * time into this frame in later slices.
 */
export function App() {
  return (
    <Routes>
      <Route element={<AppFrame />}>
        <Route path="/" element={<LibraryView />} />
        <Route path="/trash" element={<TrashView />} />
        <Route path="/tags/:name" element={<TagView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
