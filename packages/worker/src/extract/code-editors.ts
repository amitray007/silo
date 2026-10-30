export interface EditorCode {
  text: string;
  language?: string;
}

/** Standalone: injected into rendered pages as well as used on the static DOM. */
export function prepareCodeEditors(document: Document, protect = false): Map<string, EditorCode> {
  const originals = new Map<string, EditorCode>();
  const editors = '.cm-editor, .cm-content, .CodeMirror, .monaco-editor';
  const chrome =
    'button, [role="button"], [role="tab"], script, style, .cm-gutters, .CodeMirror-gutters, .line-numbers, .lineno, .linenos, .gutter';

  function codeText(element: Element, line = false): string {
    const copy = element.cloneNode(true) as Element;
    for (const node of copy.querySelectorAll(chrome)) node.remove();
    const breaks = [...copy.querySelectorAll('br')];
    // An editor's sole BR is an empty-line placeholder, not a second newline.
    if (line && /^[\n\u200b]?$/.test(copy.textContent ?? '') && breaks.length <= 1) return '';
    for (const tab of copy.querySelectorAll('[cm-text]'))
      tab.textContent = tab.getAttribute('cm-text');
    for (const br of breaks) br.replaceWith('\n');
    const text = (copy.textContent ?? '').replace(/\u00a0/g, ' ');
    return line && text === '\u200b' ? '' : text;
  }

  function editorMode(element: Element): string | null {
    if (!element.matches(editors)) return null;
    return element.getAttribute('data-language') ?? element.getAttribute('data-mode-id');
  }

  function language(element: Element): string | undefined {
    let nearby: Element | null = element;
    for (let depth = 0; nearby && depth < 4; depth++, nearby = nearby.parentElement) {
      if (nearby.matches('html, body, main, article')) break;
      const hint =
        editorMode(nearby) ??
        /(?:^|\s)(?:language-|highlight-source-)([a-z0-9][a-z0-9+#._-]{0,23})(?=\s|$)/i.exec(
          nearby.getAttribute('class') ?? '',
        )?.[1];
      if (
        hint &&
        /^[a-z0-9][a-z0-9+#._-]{0,23}$/i.test(hint) &&
        !/^(?:en|fr|de|es|it|pt|ja|zh|ko|ru|ar|hi)(?:[-_][a-z]{2,4})?$/i.test(hint)
      )
        return hint.toLowerCase();
    }
    return undefined;
  }

  function replace(element: Element, text: string, source: Element): void {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const hint = language(source) ?? language(element);
    if (hint) {
      code.setAttribute('class', `language-${hint}`);
      // The rich-block sanitizer stores data-lang, not publisher classes.
      code.setAttribute('data-lang', hint);
    }
    if (protect) {
      // Defuddle expands tabs, dedents and trims code. A per-run marker lets us
      // restore only our normalized editors after it chooses the article.
      const marker = `silo-editor-${Math.random().toString(36).slice(2)}-${originals.size}`;
      originals.set(marker, { text, ...(hint ? { language: hint } : {}) });
      code.textContent = `${marker}\n${text}`;
    } else code.textContent = text;
    pre.append(code);
    element.replaceWith(pre);
  }

  function isHidden(element: Element): boolean {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (node.matches('[hidden], [aria-hidden="true"]')) return true;
      const style = (node as HTMLElement).style;
      if (style?.display === 'none' || style?.visibility === 'hidden') return true;
      const computed = document.defaultView?.getComputedStyle?.(node);
      if (computed?.display === 'none' || computed?.visibility === 'hidden') return true;
    }
    return false;
  }

  function normalizeEditor(editor: Element): void {
    if (!editor.isConnected || editor.closest('pre') || editor.querySelector('pre > code')) return;
    if (isHidden(editor)) {
      editor.remove();
      return;
    }
    const content = editor.querySelector('.cm-content, .CodeMirror-code, .view-lines') ?? editor;
    const lines = [...content.querySelectorAll('.cm-line, .CodeMirror-line, .view-line')];
    if (!lines.length) return;
    if (editor.matches('.monaco-editor'))
      lines.sort(
        (a, b) =>
          (Number.parseFloat((a as HTMLElement).style.top) || 0) -
          (Number.parseFloat((b as HTMLElement).style.top) || 0),
      );
    // Monaco virtualizes its model. Preserve only the lines present in the DOM.
    replace(editor, lines.map((line) => codeText(line, true)).join('\n'), content);
  }

  function normalizeTable(table: Element): void {
    if (table.closest('pre') || isHidden(table) || isDiff(table)) return;
    const cells = ownCells(table, 'td.blob-code');
    if (cells.length && ownCells(table, 'td.blob-num').length) {
      replace(table, cells.map((cell) => codeText(cell, true)).join('\n'), cells[0] ?? table);
      return;
    }
    if (
      !table.matches('.highlighttable, .rouge-table') &&
      !table.closest('.highlight, .highlighter-rouge, .codehilite')
    )
      return;
    const codeCells = ownCells(table, 'td.code, td.rouge-code');
    if (!codeCells.length || !ownCells(table, 'td.gutter, td.rouge-gutter, td.linenos').length)
      return;
    replace(
      table,
      codeCells.map((cell) => codeText(cell.querySelector('pre') ?? cell)).join('\n'),
      codeCells[0] ?? table,
    );
  }
  function isDiff(table: Element): boolean {
    if (
      table.querySelector(
        '.blob-code-addition, .blob-code-deletion, .blob-code-hunk, [data-code-marker]',
      )
    )
      return true;
    return [...table.querySelectorAll('tr')].some(
      (row) =>
        row.closest('table') === table &&
        [...row.querySelectorAll('td.blob-num')].filter(
          (cell) => cell.closest('tr') === row && cell.closest('table') === table,
        ).length > 1,
    );
  }
  function ownCells(table: Element, selector: string): Element[] {
    return [...table.querySelectorAll(selector)].filter((cell) => cell.closest('table') === table);
  }
  for (const editor of document.querySelectorAll(editors)) normalizeEditor(editor);
  for (const table of document.querySelectorAll('table')) normalizeTable(table);
  return originals;
}

/** Restore text in an inert host DOM, never publisher HTML. */
export function restoreCodeEditors(
  container: ParentNode,
  originals: Map<string, EditorCode>,
): void {
  for (const code of container.querySelectorAll('pre > code')) {
    const marker = (code.textContent ?? '').split('\n', 1)[0] ?? '';
    const original = originals.get(marker);
    if (original !== undefined) {
      code.textContent = original.text;
      // Defuddle searches unbounded ancestors for language hints. Keep only ours.
      code.removeAttribute('class');
      if (original.language) code.setAttribute('data-lang', original.language);
      else code.removeAttribute('data-lang');
    }
  }
}
