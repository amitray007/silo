import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginGate } from './auth/LoginGate';
import { AppFrame } from './components';
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import { ReaderLayout } from './components/reader/ReaderLayout';
import { SegmentTabs } from './components/reader/ReaderSegment';
import { LibraryView } from './routes/LibraryView';
import { NotFoundView } from './routes/NotFoundView';
import { SettingsView } from './routes/SettingsView';
import { ContentFrame } from './routes/shared/ListHeader';
import { LoadingState } from './routes/shared/ListStates';
import { TagView } from './routes/TagView';
import { TrashView } from './routes/TrashView';

const FeedsView = lazy(() =>
  import('./routes/FeedsView').then((module) => ({ default: module.FeedsView })),
);
const LibrarianView = lazy(() =>
  import('./routes/LibrarianView').then((module) => ({ default: module.LibrarianView })),
);
const FeedView = lazy(() =>
  import('./routes/FeedView').then((module) => ({ default: module.FeedView })),
);

function FeedRouteLoading({ detail = false }: { detail?: boolean }) {
  return (
    <ReaderLayout links={[]} title="Feeds" loading>
      <ContentFrame
        title="Feeds"
        headerSlot={null}
        headerBelow={
          detail ? (
            <div className="silo-feed-tabs">
              <SegmentTabs
                id="feed-loading"
                tab="inbox"
                disabled
                label="Feed posts"
                tabs={[
                  { value: 'inbox', label: 'Inbox' },
                  { value: 'archive', label: 'Archive' },
                ]}
                setTab={() => {}}
              />
            </div>
          ) : undefined
        }
      >
        <LoadingState />
      </ContentFrame>
    </ReaderLayout>
  );
}

function LibrarianRouteLoading() {
  return (
    <div className="silo-three-pane" data-reader="false">
      <section className="silo-listpane" aria-label="Chats">
        <ContentFrame title="Chats" headerSlot={null}>
          <LoadingState />
        </ContentFrame>
      </section>
    </div>
  );
}

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
        <Route
          path="/feeds"
          element={
            <ChunkErrorBoundary kind="feed" key="feeds">
              <Suspense fallback={<FeedRouteLoading />}>
                <FeedsView />
              </Suspense>
            </ChunkErrorBoundary>
          }
        />
        <Route
          path="/feeds/:id"
          element={
            <ChunkErrorBoundary kind="feed" key="feed">
              <Suspense fallback={<FeedRouteLoading detail />}>
                <FeedView />
              </Suspense>
            </ChunkErrorBoundary>
          }
        />
        <Route
          path="/librarian"
          element={
            <ChunkErrorBoundary kind="librarian" key="librarian">
              <Suspense fallback={<LibrarianRouteLoading />}>
                <LibrarianView />
              </Suspense>
            </ChunkErrorBoundary>
          }
        />
        <Route path="/trash" element={<TrashView />} />
        <Route path="/tags/:name" element={<TagView />} />
        <Route path="/settings/*" element={<SettingsView />} />
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
