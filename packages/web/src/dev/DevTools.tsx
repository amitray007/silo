import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import './DevTools.css';
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
function FeedbackTools({ onExit }: { onExit: () => void }) {
  const started = useRef(false);
  useEffect(() => {
    const observer = new MutationObserver(activate);
    function activate() {
      const root = document.querySelector('agentation-toolbar')?.shadowRoot;
      const button = root?.querySelector<HTMLButtonElement>(
        'button[aria-label="Start feedback mode"]',
      );
      if (button) {
        if (started.current) onExit();
        else {
          started.current = true;
          button.click();
        }
      }
      if (root)
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-label'],
        });
    }
    observer.observe(document.body, { childList: true, subtree: true });
    activate();
    return () => observer.disconnect();
  }, [onExit]);
  return <Agentation />;
}

export function DevTools() {
  return import.meta.env.DEV ? <FeedbackController /> : null;
}

function FeedbackController() {
  const phone = useMediaQuery(layoutMedia.phone);
  const [requested, setRequested] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setRequested(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }, []);
  useEffect(() => {
    const show = () => setRequested(true);
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === 'f' &&
        event.shiftKey &&
        (event.metaKey || event.ctrlKey) &&
        !requested
      ) {
        event.preventDefault();
        setRequested(true);
      }
    };
    const exit = (event: MouseEvent) => {
      if (
        event
          .composedPath()
          .some(
            (target) => target instanceof Element && target.getAttribute('aria-label') === 'Exit',
          )
      )
        close();
    };
    window.addEventListener('click', exit, true);
    window.addEventListener('silo:annotate', show);
    window.addEventListener('keydown', shortcut);
    return () => {
      window.removeEventListener('click', exit, true);
      window.removeEventListener('silo:annotate', show);
      window.removeEventListener('keydown', shortcut);
    };
  }, [close, requested]);
  if (!requested)
    return phone ? null : (
      <button
        ref={launcher}
        type="button"
        className="silo-feedback-launcher"
        aria-label="Start feedback mode"
        aria-expanded={false}
        aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
        title="Start feedback mode (⌘⇧F / Ctrl+Shift+F)"
        onClick={() => setRequested(true)}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5.5 6.75h13M5.5 12h6M5.5 17.25h3.75M16 12.75l1 2.25 2.25 1-2.25 1-1 2.25L15 17l-2.25-1L15 15Z" />
        </svg>
      </button>
    );
  // Suspense with a null fallback: the toolbar simply appears once its chunk
  // loads; nothing to show meanwhile.
  return (
    <Suspense fallback={null}>
      <FeedbackTools onExit={close} />
    </Suspense>
  );
}
