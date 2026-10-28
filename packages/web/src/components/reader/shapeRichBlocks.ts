import { readerIconPath } from './ReaderIcon';

const icons = {
  note: 'note',
  info: 'page',
  tip: 'sun',
  warning: 'note',
  danger: 'close',
  quote: 'reply',
} as const;

/** Only sanitized structure enters here; labels and icons are created by Silo. */
export function shapeRichBlocks(fragment: DocumentFragment): void {
  for (const code of fragment.querySelectorAll('pre > code[data-lang]')) {
    const label = document.createElement('span');
    label.className = 'silo-reader-code-label';
    label.textContent = code.getAttribute('data-lang');
    code.parentElement?.before(label);
  }
  for (const callout of fragment.querySelectorAll<HTMLElement>(
    'div[data-callout], blockquote[data-callout]',
  )) {
    const type = callout.dataset.callout ?? 'note';
    const variant = Object.hasOwn(icons, type) ? (type as keyof typeof icons) : 'note';
    callout.dataset.calloutVariant = variant;
    const title = document.createElement('div');
    title.className = 'silo-reader-callout-title';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({
      viewBox: '0 0 24 24',
      width: '20',
      height: '20',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }))
      icon.setAttribute(name, value);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', readerIconPath(icons[variant]));
    icon.append(path);
    title.append(icon);
    const customTitle = callout.dataset.calloutTitle;
    title.append(customTitle || variant[0]?.toUpperCase() + variant.slice(1));
    callout.prepend(title);
  }
}
