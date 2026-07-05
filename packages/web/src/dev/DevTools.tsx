import { lazy, Suspense } from 'react';

/**
 * Dev-only visual-feedback toolbar (`agentation`) — a bottom-right widget for
 * annotating page elements and copying agent-legible output. Mounted only in
 * dev via a dynamic import gated on `import.meta.env.DEV`, so the module is
 * dead-code-eliminated from the production bundle entirely (it's a
 * devDependency and must never ship). See main.tsx for the render site.
 */
const Agentation = lazy(() => import('agentation').then((m) => ({ default: m.Agentation })));

export function DevTools() {
  if (!import.meta.env.DEV) return null;
  // Suspense with a null fallback: the toolbar simply appears once its chunk
  // loads; nothing to show meanwhile.
  return (
    <Suspense fallback={null}>
      <Agentation />
    </Suspense>
  );
}
