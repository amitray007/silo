/** Standalone so rendered capture can inject the same boundary repair into the page. */
export function prepareBoxSpacing(document: Document, rendered = false): void {
  const elements = [...document.querySelectorAll('*')];
  if (elements.length > 20_000) return;
  const skip = 'pre, code, textarea, script, style';
  const containers = 'a, button, li, td, th, dt, dd, summary, label';
  const tags = new Set(
    'div p h1 h2 h3 h4 h5 h6 section article header footer ul ol li dl dt dd table tr td th figure figcaption blockquote nav aside main form fieldset address hr'.split(
      ' ',
    ),
  );
  const displays = new Set(
    'block flex grid list-item table table-cell table-row flow-root inline-block inline-flex inline-grid'.split(
      ' ',
    ),
  );
  // Snapshot every style before inserting text: writes must not trigger repeated layout.
  const styles = new Map(
    rendered
      ? elements.map((element) => [
          element,
          document.defaultView?.getComputedStyle(element).display,
        ])
      : [],
  );
  const boundaries = new Map<Node, Set<Node | null>>();
  function boundary(parent: Node, left: Node | null, right: Node | null): void {
    if (!left || !right) return;
    const end = left.textContent ?? '';
    const start = right.textContent ?? '';
    if (!end || !start || /\s$/.test(end) || /^\s/.test(start)) return;
    let positions = boundaries.get(parent);
    if (!positions) {
      positions = new Set();
      boundaries.set(parent, positions);
    }
    positions.add(right);
  }
  function isSeparate(element: Element, parent: Element): boolean {
    const display = styles.get(element) ?? '';
    const parentDisplay = styles.get(parent) ?? '';
    return rendered
      ? displays.has(display) || /^(inline-)?(flex|grid)$/.test(parentDisplay)
      : tags.has(element.localName) && !!parent.closest(containers);
  }
  for (const element of elements) {
    if (element.closest(skip)) continue;
    const parent = element.parentElement;
    if (!parent) continue;
    const separate = isSeparate(element, parent);
    if (!separate) continue;
    boundary(parent, element.previousSibling, element);
    boundary(parent, element, element.nextSibling);
  }
  for (const [parent, positions] of boundaries)
    for (const right of positions) parent.insertBefore(document.createTextNode(' '), right);
}
