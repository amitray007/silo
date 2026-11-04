import createDOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { mermaidConfig } from './diagramPalette';

let sequence = 0;
let tail: Promise<void> = Promise.resolve();

function sanitizeDiagram(svg: string): DocumentFragment {
  const purifier = createDOMPurify(window);
  const fragment = purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'style', 'a', 'image', 'use'],
    FORBID_ATTR: ['href', 'xlink:href', 'src'],
    RETURN_DOM_FRAGMENT: true,
  });
  // Keep semantic line patterns and font sizes, with colors owned by Silo's CSS.
  const styleProperties = new Set([
    'stroke-dasharray',
    'stroke-width',
    'font-size',
    'font-weight',
    'font-style',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'text-anchor',
    'dominant-baseline',
  ]);
  for (const node of fragment.querySelectorAll('[style]')) {
    const declarations = (node.getAttribute('style') ?? '').split(';').filter((declaration) => {
      const [name, value] = declaration.split(':');
      return styleProperties.has(name?.trim() ?? '') && /^[\w .,%+-]+$/.test(value ?? '');
    });
    node.removeAttribute('style');
    if (declarations.length) node.setAttribute('style', declarations.join(';'));
  }
  for (const node of fragment.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (/url\s*\(/i.test(attribute.value) && !/^url\(#[\w-]+\)$/.test(attribute.value))
        node.removeAttribute(attribute.name);
    }
  }
  return fragment;
}

async function draw(code: HTMLElement, active: () => boolean): Promise<void> {
  const pre = code.parentElement;
  if (!pre || !active()) return;
  const source = code.textContent ?? '';
  mermaid.initialize(mermaidConfig(pre));
  try {
    const { svg } = await mermaid.render(`silo-diagram-${++sequence}`, source);
    if (!active()) return;
    const fragment = sanitizeDiagram(svg);
    const figure = document.createElement('figure');
    figure.className = 'silo-reader-diagram';
    figure.tabIndex = 0;
    figure.setAttribute('role', 'region');
    figure.setAttribute('aria-label', 'Mermaid diagram');
    figure.append(fragment);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Show source';
    details.append(summary);
    pre.replaceWith(figure);
    details.append(pre);
    figure.append(details);
  } catch {
    if (!active()) return;
    const note = document.createElement('p');
    note.className = 'silo-reader-block-note';
    note.textContent = 'Diagram could not be rendered';
    pre.after(note);
  }
}

/** Mermaid's singleton configuration and temporary IDs must not race between readers. */
export function renderDiagram(code: HTMLElement, active: () => boolean): Promise<void> {
  const job = tail.then(() => draw(code, active));
  tail = job.catch(() => {});
  return job;
}
