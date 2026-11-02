import { useEffect } from 'react';
import { reducedMotion } from '../../lib/motion';

export type RecedeReason = 'passage' | 'chat';
type Held = { reason: RecedeReason; range: Range | undefined };
type Rect = { left: number; top: number; right: number; bottom: number };

/** Inline elements can report the same line twice; overlapping holes would cancel with evenodd. */
function selectionRects(range: Range | undefined): Rect[] {
  const rows: Rect[] = [];
  for (const rect of Array.from(range?.getClientRects?.() ?? []).sort(
    (a, b) => a.top - b.top || a.left - b.left,
  )) {
    if (rect.width === 0 || rect.height === 0) continue;
    const row = rows.at(-1);
    if (row && rect.top < row.bottom && rect.bottom > row.top && rect.left <= row.right + 1) {
      row.left = Math.min(row.left, rect.left);
      row.top = Math.min(row.top, rect.top);
      row.right = Math.max(row.right, rect.right);
      row.bottom = Math.max(row.bottom, rect.bottom);
    } else rows.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  return rows;
}

/** A single scroll-content layer, shared by the passage and the dock chat. */
class RecedeLayer {
  private readonly held = new Set<Held>();
  private readonly node = document.createElement('div');
  private readonly scroll: HTMLElement | null;
  private article: HTMLElement | null = null;
  private readonly resize: ResizeObserver | undefined;
  private readonly mutations: MutationObserver | undefined;
  private frame = 0;
  private removal = 0;

  constructor(private readonly pane: Element) {
    this.scroll = pane.querySelector<HTMLElement>('.silo-reader-scroll');
    this.node.className = 'silo-reader-recede';
    this.node.setAttribute('aria-hidden', 'true');
    if (!this.scroll) return;
    this.scroll.append(this.node);
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(this.schedule);
      if (this.scroll) this.resize.observe(this.scroll);
    }
    this.mutations = new MutationObserver(this.schedule);
    if (this.scroll) this.mutations.observe(this.scroll, { childList: true });
    this.watchArticle();
    window.addEventListener('resize', this.schedule);
    document.fonts?.addEventListener('loadingdone', this.schedule);
  }

  private watchArticle() {
    const article = this.scroll?.querySelector<HTMLElement>('.silo-reader') ?? null;
    if (article === this.article) return;
    if (this.article) this.resize?.unobserve(this.article);
    this.article = article;
    this.mutations?.disconnect();
    if (this.scroll) this.mutations?.observe(this.scroll, { childList: true });
    if (article) {
      this.resize?.observe(article);
      this.mutations?.observe(article, {
        attributes: true,
        attributeFilter: ['style', 'data-width'],
      });
    }
  }

  private showReasons() {
    this.pane.setAttribute(
      'data-recede',
      [...new Set([...this.held].map((item) => item.reason))].join(' '),
    );
  }

  private schedule = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  };

  private update() {
    const scroll = this.scroll;
    if (!scroll || this.held.size === 0) return;
    this.watchArticle();
    const bounds = scroll.getBoundingClientRect();
    const x = scroll.scrollLeft - bounds.left - scroll.clientLeft;
    const y = scroll.scrollTop - bounds.top - scroll.clientTop;
    const width = scroll.clientWidth;
    const height = Math.max(
      scroll.clientHeight,
      (this.article?.getBoundingClientRect().bottom ?? bounds.bottom) + y,
    );
    const range = [...this.held].find((entry) => entry.range)?.range;
    const holes = selectionRects(range).map(
      (rect) =>
        `M${rect.left + x} ${rect.top + y}H${rect.right + x}V${rect.bottom + y}H${rect.left + x}Z`,
    );
    this.node.style.height = `${height}px`;
    this.node.style.clipPath = holes.length
      ? `path(evenodd, "M0 0H${width}V${height}H0Z ${holes.join(' ')}")`
      : 'none';
  }

  add(entry: Held) {
    window.clearTimeout(this.removal);
    this.held.add(entry);
    this.update();
    this.showReasons();
  }

  remove(entry: Held) {
    this.held.delete(entry);
    if (this.held.size) {
      this.update();
      this.showReasons();
      return;
    }
    this.pane.removeAttribute('data-recede');
    // Keep the cut-out until the fade ends, so closing cannot flash blurred selected text.
    if (reducedMotion() || !this.node.isConnected) this.dispose();
    else this.removal = window.setTimeout(() => this.dispose(), 220);
  }

  private dispose() {
    cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.mutations?.disconnect();
    window.removeEventListener('resize', this.schedule);
    document.fonts?.removeEventListener('loadingdone', this.schedule);
    this.node.remove();
    layers.delete(this.pane);
  }
}

const layers = new WeakMap<Element, RecedeLayer>();

/** Selection geometry changes with typography and resize, never with scrolling or streamed tokens. */
export function useRecede(
  host: Element | null,
  reason: RecedeReason,
  active: boolean,
  range?: Range,
) {
  useEffect(() => {
    const pane = host?.closest('.silo-readerpane');
    if (!pane || !active) return;
    let layer = layers.get(pane);
    if (!layer) {
      layer = new RecedeLayer(pane);
      layers.set(pane, layer);
    }
    const entry = { reason, range };
    layer.add(entry);
    return () => layer.remove(entry);
  }, [host, reason, active, range]);
}
