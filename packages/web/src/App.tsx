import { Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginGate } from './auth/LoginGate';
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
function AppRoutes() {
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

/**
 * Gates `AppRoutes` behind the auth state (plan 030 Unit 3): `'loading'`
 * renders nothing (avoids flashing the login card before the initial
 * `GET /api/auth/check` resolves — see `AuthContext`'s doc comment), `'open'`
 * / `'authed'` render the real app, `'needs-login'` renders `LoginGate`
 * INSTEAD of the routes (no partial app behind it to protect).
 */
function AuthGate() {
  const { state } = useAuth();

  if (state === 'loading') return null;
  if (state === 'needs-login') return <LoginGate />;
  return <AppRoutes />;
}

/**
 * `AuthProvider` wraps the gate here (rather than in `main.tsx`) because it
 * needs the api client, which works unmodified either place, but keeping it
 * inside `App`'s own tree keeps `main.tsx` a pure provider-stack and this
 * file the single "what does the authenticated app look like" entry point.
 * It sits inside `QueryClientProvider` + `BrowserRouter` (both already wrap
 * `<App/>` in `main.tsx`), which is what it needs.
 */
export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
