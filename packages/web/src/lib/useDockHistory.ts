import { useEffect, useRef } from 'react';

const MARKER = 'siloDock';
type CloseReason = 'back' | 'navigate';
type DockEntry = {
  token: string;
  url: string;
  close: (reason: CloseReason) => void;
  popped: () => void;
};
let current: DockEntry | undefined;
let consuming: Promise<void> | undefined;

function owns(entry: DockEntry) {
  return window.location.href === entry.url && window.history.state?.[MARKER] === entry.token;
}

function forget(entry: DockEntry) {
  window.removeEventListener('popstate', entry.popped);
  if (current === entry) current = undefined;
}

function consume(entry: DockEntry) {
  forget(entry);
  if (!owns(entry)) return;
  consuming = new Promise<void>((resolve) => {
    window.addEventListener(
      'popstate',
      () => {
        consuming = undefined;
        resolve();
      },
      { once: true },
    );
    window.history.back();
  });
}

/** Article navigation waits for the overlay's Back, so it cannot land on the next article. */
export function afterDockHistory(navigate: () => void) {
  if (current) {
    const entry = current;
    consume(entry);
    entry.close('navigate');
  }
  if (consuming) void consuming.then(navigate);
  else navigate();
}

/** Dock controls leave selections in chat and elsewhere untouched. */
export function clearArticleSelection(prose: HTMLElement | null) {
  const selection = window.getSelection();
  if (selection?.rangeCount && prose?.contains(selection.getRangeAt(0).commonAncestorContainer))
    selection.removeAllRanges();
}

/** One same-URL entry protects the reader beneath the dock's top overlay. */
export function useDockHistory(
  overlay: string | null,
  onClose: (reason: CloseReason) => void,
  prose: HTMLElement | null,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!overlay) return;
    clearArticleSelection(prose);
    let cancelled = false;
    let entry: DockEntry | undefined;
    const push = () => {
      if (cancelled) return;
      entry = {
        token: crypto.randomUUID(),
        url: window.location.href,
        close: (reason) => close.current(reason),
        popped: () => {
          if (!entry || owns(entry)) return;
          forget(entry);
          entry.close('back');
        },
      };
      current = entry;
      const state = window.history.state;
      window.history.pushState(
        { ...state, idx: (state?.idx ?? 0) + 1, [MARKER]: entry.token },
        '',
        entry.url,
      );
      window.addEventListener('popstate', entry.popped);
    };
    if (consuming) void consuming.then(push);
    else push();
    return () => {
      cancelled = true;
      if (entry && current === entry) consume(entry);
    };
  }, [overlay, prose]);
}
