/** Collapse prose whitespace while retaining code line breaks. */
export function readerText(container: Element): string {
  const parts: string[] = [];
  let prose = '';
  function flush(): void {
    const text = prose.replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
    prose = '';
  }
  function visit(node: Node): void {
    if (node.nodeType === 1 && (node as Element).localName === 'pre') {
      flush();
      parts.push((node.textContent ?? '').replace(/[ \t]+/g, ' '));
      return;
    }
    if (node.nodeType === 3) prose += node.textContent ?? '';
    else for (const child of node.childNodes) visit(child);
  }
  visit(container);
  flush();
  return parts.join('\n');
}
