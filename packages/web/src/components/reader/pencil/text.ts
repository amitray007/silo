/** Text the pencil never sweeps: code, figures and captions, tables, math, controls, notes. */
const SKIP_SELECTOR =
  'pre, figure, figcaption, caption, table, math, svg, script, style, button, .silo-reader-card, [aria-hidden="true"], a[title="return to article"]';

/** Visible prose text nodes in document order, minus code, figures and tables. */
export function proseTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (parent && text.data.trim() && !parent.closest(SKIP_SELECTOR)) nodes.push(text);
  }
  return nodes;
}
