import { supportedLanguage } from './codeLanguages';

/** Schedule one block per animation frame so plain prose paints before decoration. */
export function decorateBlocks(root: HTMLElement): () => void {
  let active = true;
  let frame = 0;
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code[data-lang]')].filter(
    (code) => code.dataset.lang === 'mermaid' || supportedLanguage(code.dataset.lang ?? ''),
  );
  const next = () => {
    const code = blocks.shift();
    if (!active || !code) return;
    const visible = () => active && root.contains(code);
    const decorate =
      code.dataset.lang === 'mermaid'
        ? import('./renderDiagram').then((module) => module.renderDiagram(code, visible))
        : import('./highlightCode').then((module) => module.highlightCode(code, visible));
    void decorate
      .catch(() => {})
      .finally(() => {
        if (active) frame = requestAnimationFrame(next);
      });
  };
  if (blocks.length) frame = requestAnimationFrame(next);
  return () => {
    active = false;
    cancelAnimationFrame(frame);
  };
}
