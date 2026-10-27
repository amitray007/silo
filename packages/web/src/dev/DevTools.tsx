import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { layoutMedia, useMediaQuery } from '../lib/breakpoints';

/**
 * Dev-only visual-feedback toolbar (`agentation`) — a bottom-right widget for
 * annotating page elements and copying agent-legible output. Mounted only in
 * dev via a dynamic import gated on `import.meta.env.DEV`, so the module is
 * dead-code-eliminated from the production bundle entirely (it's a
 * devDependency and must never ship). See main.tsx for the render site.
 */
const Agentation = lazy(() => import('agentation').then((m) => ({ default: m.Agentation })));

/** The dev tool exposes its launcher through its shadow-root button. */
function FeedbackTools({ start }: { start: boolean }) {
  const started = useRef(false);
  useEffect(() => {
    if (!start || started.current) return;
    const observer = new MutationObserver(activate);
    function activate() {
      if (started.current) return;
      const root = document.querySelector('agentation-toolbar')?.shadowRoot;
      const button = root?.querySelector<HTMLButtonElement>(
        'button[aria-label="Start feedback mode"]',
      );
      if (button) {
        started.current = true;
        button.click();
        observer.disconnect();
      } else if (root) {
        observer.observe(root, { childList: true, subtree: true });
      }
    }
    observer.observe(document.body, { childList: true, subtree: true });
    activate();
    return () => observer.disconnect();
  }, [start]);
  return <Agentation />;
}

export function DevTools() {
  return import.meta.env.DEV ? <FeedbackController /> : null;
}

function FeedbackController() {
  const phone = useMediaQuery(layoutMedia.phone);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    const show = () => setRequested(true);
    const hide = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRequested(false);
    };
    const exit = (event: MouseEvent) => {
      if (
        event
          .composedPath()
          .some(
            (target) => target instanceof Element && target.getAttribute('aria-label') === 'Exit',
          )
      )
        setRequested(false);
    };
    window.addEventListener('click', exit, true);
    window.addEventListener('silo:annotate', show);
    window.addEventListener('keydown', hide);
    return () => {
      window.removeEventListener('click', exit, true);
      window.removeEventListener('silo:annotate', show);
      window.removeEventListener('keydown', hide);
    };
  }, []);
  if (phone && !requested) return null;
  // Suspense with a null fallback: the toolbar simply appears once its chunk
  // loads; nothing to show meanwhile.
  return (
    <Suspense fallback={null}>
      <FeedbackTools start={phone && requested} />
    </Suspense>
  );
}
