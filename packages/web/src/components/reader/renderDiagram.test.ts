import mermaid from 'mermaid';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderDiagram } from './renderDiagram';

// The engine and sanitizer are real. jsdom only needs SVG text measurements.
beforeEach(() => {
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const styles = computedStyle(element, pseudo);
    // jsdom does not resolve CSS custom properties to RGB.
    if (element instanceof HTMLSpanElement)
      Object.defineProperty(styles, 'color', { value: 'rgb(20, 20, 20)' });
    return styles;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
  });
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
    configurable: true,
    value: () => 100,
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength');
});

it.each([
  ['click JavaScript', 'flowchart TD\n A[Safe] --> B[End]\n click A "javascript:alert(1)"'],
  ['href', 'flowchart TD\n A[Safe] --> B[End]\n click A href "https://evil.test/link"'],
  [
    'classDef URL',
    'flowchart TD\n A[Safe] --> B[End]\n classDef hostile fill:url\\28https://evil.test/fill\\29,stroke-width:3px;\n class A hostile;',
  ],
  [
    'style URL',
    'flowchart TD\n A[Safe] --> B[End]\n style A fill:url\\28https://evil.test/style\\29,stroke-dasharray:5 5;',
  ],
  [
    'themeCSS directive',
    '%%{init: {"themeCSS":"@import url(https://evil.test/theme); .node {fill:url(https://evil.test/fill)}"}}%%\nflowchart TD\n A[Safe] --> B[End]',
  ],
  [
    'fontFamily directive',
    '%%{init: {"fontFamily":"evil; background-image:url(https://evil.test/font)","themeVariables":{"fontFamily":"url(https://evil.test/nested)"}}}%%\nflowchart TD\n A[Safe] --> B[End]',
  ],
  [
    'HTML labels',
    '%%{init: {"securityLevel":"loose","htmlLabels":true,"flowchart":{"htmlLabels":true}}}%%\nflowchart TD\n A["<img src=\'https://evil.test/image\' onerror=\'alert(1)\'><b>Safe</b>"] --> B[End]',
  ],
])(
  'sanitizes hostile %s through the real Mermaid engine',
  async (_name, source) => {
    const pre = document.createElement('pre');
    pre.style.fontFamily = 'Inter, sans-serif';
    const code = document.createElement('code');
    code.textContent = source;
    pre.append(code);
    document.body.append(pre);
    await renderDiagram(code, () => true);
    const svg = document.querySelector('.silo-reader-diagram > svg');
    expect(svg, document.body.textContent ?? '').not.toBeNull();
    expect(
      svg?.querySelector('style, foreignObject, script, [href], [src], [xlink\\:href]'),
    ).toBeNull();
    for (const node of svg ? [svg, ...svg.querySelectorAll('*')] : []) {
      for (const attribute of node.attributes) {
        expect(attribute.name).not.toMatch(/^on/i);
        if (/url\s*\(/i.test(attribute.value)) expect(attribute.value).toMatch(/^url\(#[\w-]+\)$/);
      }
    }
    expect(mermaid.mermaidAPI.getConfig().fontFamily).toBe('Inter, sans-serif');
    expect(mermaid.mermaidAPI.getConfig().secure).toContain('fontFamily');
    // Mermaid's installed merger retains its default secure keys.
    expect(mermaid.mermaidAPI.getConfig().secure).toContain('maxEdges');
  },
  15_000,
);

it('keeps permitted inline line patterns from the real engine', async () => {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent =
    'flowchart TD\n A[Safe] --> B[End]\n style A stroke-dasharray:5 5,stroke-width:3px;';
  pre.append(code);
  document.body.append(pre);
  await renderDiagram(code, () => true);
  const svg = document.querySelector('.silo-reader-diagram > svg');
  expect(svg).not.toBeNull();
  expect(svg?.querySelector('[style*="stroke-dasharray"]')).not.toBeNull();
  expect(svg?.querySelector('[style*="stroke-width"]')).not.toBeNull();
});

it.each(['classDef hostile', 'style A'])(
  'keeps rejected literal url() in %s as inert source with no inserted SVG',
  async (statement) => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const source = `flowchart TD\n A[Safe] --> B[End]\n ${statement} fill:url(https://evil.test/fill);`;
    code.textContent = source;
    pre.append(code);
    document.body.append(pre);
    await renderDiagram(code, () => true);
    expect(document.querySelector('svg, style, foreignObject, [href], [src]')).toBeNull();
    expect(code.textContent).toBe(source);
    expect(document.querySelector('.silo-reader-block-note')?.textContent).toBe(
      'Diagram could not be rendered',
    );
  },
);
