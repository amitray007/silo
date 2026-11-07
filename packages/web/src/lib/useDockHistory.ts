import { useEffect, useRef } from 'react';

const MARKER = 'siloDock';
type DockEntry = {
  token: string;
  url: string;
  close: () => void;
};
let current: DockEntry | undefined;
let consuming: Promise<void> | undefined;
let finishConsuming: (() => void) | undefined;
let listening = false;
let lastIndex: number | undefined;
let tail: { token: string; length: number } | undefined;

function historyIndex(): number | undefined {
  const index = window.history.state?.idx;
  return typeof index === 'number' ? index : undefined;
}

function onPopState(event: PopStateEvent) {
  const index = historyIndex();
  const previous = lastIndex;
  lastIndex = index;
  if (current && !owns(current)) {
    const entry = current;
    current = undefined;
    entry.close();
  }
  const token = window.history.state?.[MARKER];
  if (token && token !== current?.token && index !== undefined && previous !== undefined) {
    const direction = Math.sign(index - previous);
    if (direction) {
      // React Router must only see the final destination, not an abandoned dock entry.
      event.stopImmediatePropagation();
      const atTail =
        tail !== undefined && tail.token === token && tail.length === window.history.length;
      // Forward has no destination beyond the tail; return to the article instead.
      if (direction > 0 && !atTail) window.history.forward();
      else window.history.back();
      return;
    }
  }
  const finish = finishConsuming;
  finishConsuming = undefined;
  consuming = undefined;
  finish?.();
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPopState, { capture: true });
}

function owns(entry: DockEntry) {
  return window.location.href === entry.url && window.history.state?.[MARKER] === entry.token;
}

function forget(entry: DockEntry) {
  if (current === entry) current = undefined;
}

function consume(entry: DockEntry) {
  lastIndex = historyIndex();
  forget(entry);
  if (!owns(entry)) return;
  consuming = new Promise<void>((resolve) => {
    finishConsuming = resolve;
    window.history.back();
  });
}

/** Article navigation waits for the overlay's Back, so it cannot land on the next article. */
export function afterDockHistory(navigate: () => void) {
  if (current) {
    const entry = current;
    consume(entry);
    entry.close();
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

/** One same-URL entry protects the reader while any dock overlay is open. */
export function useDockHistory(open: boolean, onClose: () => void, prose: HTMLElement | null) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (open) clearArticleSelection(prose);
  }, [open, prose]);
  useEffect(() => {
    listen();
    if (!open) return;
    let cancelled = false;
    let entry: DockEntry | undefined;
    const push = () => {
      if (cancelled) return;
      entry = {
        token: crypto.randomUUID(),
        url: window.location.href,
        close: () => close.current(),
      };
      current = entry;
      const state = window.history.state;
      window.history.pushState(
        { ...state, idx: (state?.idx ?? 0) + 1, [MARKER]: entry.token },
        '',
        entry.url,
      );
      lastIndex = historyIndex();
      tail = { token: entry.token, length: window.history.length };
    };
    if (consuming) void consuming.then(push);
    else push();
    return () => {
      cancelled = true;
      if (entry && current === entry) consume(entry);
    };
  }, [open]);
}
