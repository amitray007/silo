import { type RefObject, useEffect, useState } from 'react';

/** The Reader's prose renders after the pane mounts and is replaced on refresh, so watch for it. */
export function useProseRoot(scrollRef: RefObject<HTMLElement | null>): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const find = () => setRoot(scroll.querySelector<HTMLElement>('.silo-reader-prose'));
    find();
    const observer = new MutationObserver(find);
    observer.observe(scroll, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scrollRef]);
  return root;
}

/** Text the tools never read, sweep, or speak. */
export const SKIP_SELECTOR =
  'pre, figure, table, math, svg, script, style, button, .silo-reader-card';

export const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, dd, dt, div';

/** Visible prose text nodes in document order, minus code, figures and tables. */
export function proseTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent || !text.data.trim()) continue;
    if (
      parent.closest(SKIP_SELECTOR) ||
      parent.closest('[aria-hidden="true"], a[title="return to article"]')
    )
      continue;
    nodes.push(text);
  }
  return nodes;
}

export function scrollToRange(scroll: HTMLElement, range: Range) {
  const rect = range.getBoundingClientRect();
  const box = scroll.getBoundingClientRect();
  scroll.scrollTo({
    top: scroll.scrollTop + rect.top - box.top - box.height * 0.3,
    behavior: 'smooth',
  });
}
