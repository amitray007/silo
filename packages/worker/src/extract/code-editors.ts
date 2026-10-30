/** Standalone: injected into rendered pages as well as used on the static DOM. */
export function prepareCodeEditors(document: Document, protect = false): Map<string, string> {
  const originals = new Map<string, string>();
  const editors = '.cm-editor, .cm-content, .CodeMirror, .monaco-editor';
  const chrome =
    'button, [role="button"], [role="tab"], script, style, .cm-gutters, .CodeMirror-gutters, .line-numbers, .lineno, .linenos, .gutter';

  function codeText(element: Element, line = false): string {
    const copy = element.cloneNode(true) as Element;
    for (const node of copy.querySelectorAll(chrome)) node.remove();
    const breaks = [...copy.querySelectorAll('br')];
    // An editor's sole BR is an empty-line placeholder, not a second newline.
    if (line && !copy.textContent && breaks.length === 1) return '';
    for (const br of breaks) br.replaceWith('\n');
    const text = (copy.textContent ?? '').replace(/\u00a0/g, ' ');
    return line && text === '\u200b' ? '' : text;
  }

  function language(element: Element): string | undefined {
    let nearby: Element | null = element;
    for (let depth = 0; nearby && depth < 4; depth++, nearby = nearby.parentElement) {
      if (nearby.matches('html, body, main, article')) break;
      const hint =
        nearby.getAttribute('data-language') ??
        nearby.getAttribute('data-lang') ??
        nearby.getAttribute('data-mode-id') ??
        /(?:^|\s)(?:language-|lang-|highlight-source-)([a-z0-9][a-z0-9+#._-]{0,23})(?=\s|$)/i.exec(
          nearby.getAttribute('class') ?? '',
        )?.[1];
      if (hint && /^[a-z0-9][a-z0-9+#._-]{0,23}$/i.test(hint)) return hint.toLowerCase();
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
      originals.set(marker, text);
      code.textContent = `${marker}\n${text}`;
    } else code.textContent = text;
    pre.append(code);
    element.replaceWith(pre);
  }

  function normalizeEditor(editor: Element): void {
    if (!editor.isConnected || editor.closest('pre') || editor.querySelector('pre > code')) return;
    const content = editor.querySelector('.cm-content, .CodeMirror-code, .view-lines') ?? editor;
    const lines = [...content.querySelectorAll('.cm-line, .CodeMirror-line, .view-line')];
    if (!lines.length) return;
    // Monaco virtualizes its model. Preserve only the lines present in the DOM.
    replace(editor, lines.map((line) => codeText(line, true)).join('\n'), content);
  }

  function normalizeTable(table: Element): void {
    if (table.closest('pre')) return;
    const cells = ownCells(table, 'td.blob-code');
    if (cells.length && ownCells(table, 'td.blob-num').length) {
      replace(table, cells.map((cell) => codeText(cell)).join('\n'), cells[0] ?? table);
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
  function ownCells(table: Element, selector: string): Element[] {
    return [...table.querySelectorAll(selector)].filter((cell) => cell.closest('table') === table);
  }
  for (const editor of document.querySelectorAll(editors)) normalizeEditor(editor);
  for (const table of document.querySelectorAll('table')) normalizeTable(table);
  return originals;
}

/** Standalone for browser injection. Restore text, never publisher HTML. */
export function restoreCodeEditors(container: ParentNode, originals: Map<string, string>): void {
  for (const code of container.querySelectorAll('pre > code')) {
    const marker = (code.textContent ?? '').split('\n', 1)[0] ?? '';
    const original = originals.get(marker);
    if (original !== undefined) code.textContent = original;
  }
}
