import createDOMPurify from 'dompurify';
import mermaid from 'mermaid';

let sequence = 0;
let tail: Promise<void> = Promise.resolve();

/** Resolve CSS colors to rgb: Mermaid's color parser cannot read oklch or CSS variables. */
function palette(root: HTMLElement): Record<string, string> {
  const probe = document.createElement('span');
  root.append(probe);
  const colors: Record<string, string> = {};
  const canvas = document.createElement('canvas').getContext('2d');
  for (const token of ['ink', 'bg', 'bg2', 'mut', 'line-2']) {
    probe.style.color = `var(--${token})`;
    if (canvas) {
      canvas.fillStyle = getComputedStyle(probe).color;
      const data = canvas.getImageData(0, 0, 1, 1);
      canvas.fillRect(0, 0, 1, 1);
      const pixel = canvas.getImageData(0, 0, 1, 1).data;
      colors[token] = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
      canvas.putImageData(data, 0, 0);
    } else colors[token] = getComputedStyle(probe).color;
  }
  probe.remove();
  return colors;
}

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
  const colors = palette(pre);
  mermaid.initialize({
    securityLevel: 'strict',
    startOnLoad: false,
    secure: [
      'securityLevel',
      'startOnLoad',
      'htmlLabels',
      'flowchart',
      'theme',
      'themeVariables',
      'themeCSS',
      'fontFamily',
      'maxTextSize',
      'suppressErrorRendering',
    ],
    htmlLabels: false,
    theme: 'base',
    fontFamily: getComputedStyle(pre).fontFamily,
    suppressErrorRendering: true,
    flowchart: { htmlLabels: false },
    themeVariables: {
      background: colors.bg,
      primaryColor: colors.bg2,
      primaryTextColor: colors.ink,
      primaryBorderColor: colors['line-2'],
      lineColor: colors.mut,
      secondaryColor: colors.bg2,
      tertiaryColor: colors.bg,
      textColor: colors.ink,
      nodeTextColor: colors.ink,
      fontFamily: getComputedStyle(pre).fontFamily,
    },
  });
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
