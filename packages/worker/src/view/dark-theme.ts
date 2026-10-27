import { type CssToken, cssTokens } from './css-tokens.js';

function cssText(css: string): string {
  return cssTokens(css)
    .map((token) => (token.kind === 'string' || token.kind === 'url' ? ' ' : token.value))
    .join('');
}

function darkMedia(media: string): boolean {
  return cssText(media)
    .split(',')
    .some(
      (query) =>
        !/(?<![\w-])not(?![\w-])/i.test(query) &&
        /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/i.test(query),
    );
}

const MAX_THEME_CSS = 256 * 1024;
const GROUP = /^(?:media|supports|layer|container)$/i;
type ThemeBlock = { start: number; open: number; group: boolean; eligible: boolean; dark: boolean };

function declarationCandidate(tokens: CssToken[], start: number, end: number): boolean {
  const text = tokens
    .slice(start, end)
    .map((token) => (token.kind === 'string' || token.kind === 'url' ? ' ' : token.value))
    .join('');
  return /(?<![\w-])color-scheme\s*:[^;{}]*\bdark\b|(?<![\w-])light-dark\s*\(/i.test(text);
}

function themeBlock(
  tokens: CssToken[],
  start: number,
  open: number,
  parent?: ThemeBlock,
): ThemeBlock {
  let first = start;
  while (tokens[first]?.kind === 'space') first++;
  const at = tokens[first]?.kind === 'at';
  const group = at && GROUP.test(tokens[first]?.value ?? '');
  const prelude = group
    ? tokens
        .slice(first + 1, open)
        .map((token) => token.raw)
        .join('')
    : '';
  return {
    start,
    open,
    group,
    eligible: (parent?.eligible ?? true) && (!at || group),
    dark: (parent?.dark ?? false) || (group && darkMedia(prelude)),
  };
}

/** Select rules with theme evidence without building a page-sized CSSOM. Null means over budget. */
function themeCandidates(css: string, remaining: number, inDarkMedia: boolean): string | null {
  // Most large sheets have no signal. Escapes still go through the tokenizer for decoding.
  if (!inDarkMedia && !/color-scheme|light-dark|\\/i.test(css)) return '';
  if (inDarkMedia) {
    const wrapped = `@media (prefers-color-scheme:dark){${css}}`;
    return Buffer.byteLength(wrapped) > remaining ? null : wrapped;
  }
  return collectCandidates(cssTokens(css), remaining);
}

function boundedSnippet(
  tokens: CssToken[],
  start: number,
  end: number,
  remaining: number,
): string | null {
  let snippet = '';
  for (let index = start; index <= end; index++) {
    const raw = tokens[index]?.raw ?? '';
    remaining -= Buffer.byteLength(raw);
    if (remaining < 0) return null;
    snippet += raw;
  }
  return snippet;
}

function collectCandidates(tokens: CssToken[], remaining: number): string | null {
  const blocks: ThemeBlock[] = [];
  let start = 0;
  let snippets = '';
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token?.kind !== 'symbol') continue;
    switch (token.value) {
      case '{':
        blocks.push(themeBlock(tokens, start, index, blocks.at(-1)));
        start = index + 1;
        break;
      case '}': {
        const block = blocks.pop();
        if (block && candidateBlock(tokens, block, index, blocks.at(-1))) {
          const snippet = boundedSnippet(tokens, block.start, index, remaining);
          if (snippet === null) return null;
          remaining -= Buffer.byteLength(snippet);
          snippets += snippet;
        }
        start = index + 1;
        break;
      }
      case ';':
        start = index + 1;
        break;
    }
  }
  return snippets;
}

function candidateBlock(
  tokens: CssToken[],
  block: ThemeBlock,
  end: number,
  parent?: ThemeBlock,
): boolean {
  if (!block.eligible || parent?.dark) return false;
  return block.dark || (!block.group && declarationCandidate(tokens, block.open + 1, end));
}

const STATE =
  /^(?:hover|focus(?:-visible|-within)?|active|visited|link|any-link|target(?:-within)?|checked|indeterminate|disabled|enabled|valid|invalid|user-valid|user-invalid|placeholder-shown|autofill|open|fullscreen|modal|playing|paused)$/i;

function pseudoEnd(tokens: CssToken[], index: number): number | undefined {
  if (tokens[index]?.kind !== 'symbol' || tokens[index]?.value !== ':') return undefined;
  const pseudoElement = tokens[index + 1]?.value === ':';
  const nameIndex = index + (pseudoElement ? 2 : 1);
  const name = tokens[nameIndex];
  if (name?.kind !== 'name') return undefined;
  if (
    !pseudoElement &&
    !STATE.test(name.value) &&
    !/^(?:before|after|first-line|first-letter)$/i.test(name.value)
  )
    return undefined;
  if (tokens[nameIndex + 1]?.value !== '(') return nameIndex;
  return functionEnd(tokens, nameIndex + 1);
}

function functionEnd(tokens: CssToken[], index: number): number {
  let depth = 0;
  for (; index < tokens.length; index++) {
    if (tokens[index]?.kind !== 'symbol') continue;
    if (tokens[index]?.value === '(') depth++;
    if (tokens[index]?.value === ')' && --depth === 0) return index;
  }
  return index;
}

/** Keep quoted attributes and structural pseudo-classes intact. */
function stripSelectorState(selector: string): string {
  const tokens = cssTokens(selector);
  let result = '';
  for (let index = 0; index < tokens.length; index++) {
    const end = pseudoEnd(tokens, index);
    if (end === undefined) result += tokens[index]?.raw ?? '';
    else index = end;
  }
  return result.trim() || '*';
}

function selectorMatches(document: Document, selector: string): boolean {
  try {
    return document.querySelector(stripSelectorState(selector)) !== null;
  } catch {
    // New or unsupported selector syntax must not force a filter over a native theme.
    return true;
  }
}

function darkDeclarations(style: CSSStyleDeclaration): boolean {
  return Array.from({ length: style.length }, (_, index) => style.item(index)).some((name) => {
    const value = cssText(style.getPropertyValue(name));
    return (
      (name.toLowerCase() === 'color-scheme' && /(?<![\w-])dark(?![\w-])/i.test(value)) ||
      /(?<![\w-])light-dark\s*\(/i.test(value)
    );
  });
}

type ThemeRule = CSSRule & {
  selectorText?: string;
  style?: CSSStyleDeclaration;
  cssRules?: CSSRuleList;
  media?: MediaList;
};

function rulesHaveDarkTheme(rules: CSSRuleList, document: Document, inDarkMedia: boolean): boolean {
  for (const rule of Array.from(rules) as ThemeRule[]) {
    if (
      rule.selectorText &&
      rule.style &&
      (inDarkMedia || darkDeclarations(rule.style)) &&
      selectorMatches(document, rule.selectorText)
    )
      return true;
    if (
      rule.cssRules &&
      rulesHaveDarkTheme(
        rule.cssRules,
        document,
        inDarkMedia || darkMedia(rule.media?.mediaText ?? ''),
      )
    )
      return true;
  }
  return false;
}

/** Inspect sanitized styles as text; activate only bounded candidate rules in the script-free DOM. */
export function pageHasDarkTheme(document: Document): boolean {
  const metaDark = Array.from(document.querySelectorAll('meta[name]')).some(
    (meta) =>
      meta.getAttribute('name')?.toLowerCase() === 'color-scheme' &&
      /(?:^|\s)dark(?:\s|$)/i.test(meta.getAttribute('content') ?? ''),
  );
  if (metaDark) return true;
  for (const link of document.querySelectorAll('link[media]')) {
    if (kept(link) && darkMedia(link.getAttribute('media') ?? '')) return true;
  }
  for (const element of document.querySelectorAll<HTMLElement>('[style]')) {
    if (kept(element) && darkDeclarations(element.style)) return true;
  }
  const css = documentThemeCandidates(document);
  if (css === null) return true;
  if (!css) return false;
  const probe = document.createElement('style');
  probe.textContent = css;
  document.head.append(probe);
  const sheet = probe.sheet;
  probe.remove();
  return sheet ? rulesHaveDarkTheme(sheet.cssRules, document, false) : false;
}

// Detection reads the DOM before DOMPurify runs; skip what the sanitizer drops.
const REMOVED = 'svg, math, script, template, iframe, object, embed';
function kept(element: Element): boolean {
  return element.namespaceURI === 'http://www.w3.org/1999/xhtml' && !element.closest(REMOVED);
}

function documentThemeCandidates(document: Document): string | null {
  let css = '';
  let remaining = MAX_THEME_CSS;
  for (const style of document.querySelectorAll('style')) {
    if (!kept(style)) continue;
    if (!/^(?:text\/(?:css|silo-css))?$/i.test(style.getAttribute('type')?.trim() ?? '')) continue;
    const candidates = themeCandidates(style.textContent ?? '', remaining, darkMedia(style.media));
    if (candidates === null) return null;
    remaining -= Buffer.byteLength(candidates);
    css += candidates;
  }
  return css;
}

/** Read before sanitization; these scripts run only in a direct publisher frame. */
export function pageHasDarkScript(document: Document): boolean {
  return Array.from(document.querySelectorAll('script:not([src])')).some((script) => {
    const rawType = script.getAttribute('type') ?? '';
    const type = rawType.trim().toLowerCase();
    const executable =
      rawType === '' ||
      type === 'module' ||
      /^(?:application|text)\/(?:x-)?(?:java|ecma)script$|^text\/(?:javascript1\.[0-5]|jscript|livescript)$/.test(
        type,
      );
    return executable && /prefers-color-scheme/i.test(script.textContent ?? '');
  });
}

const MEDIA =
  'img, video, canvas, iframe, embed, object, svg image, [style*="background-image" i]:not(html)';
const DARK_STYLE = `<style data-silo-dark-page>
@media (prefers-color-scheme: dark) {
  html { background: white !important; filter: invert(0.9) hue-rotate(180deg) !important; }
  :is(${MEDIA}):not(:is(${MEDIA}) *) { filter: invert(1) hue-rotate(180deg) !important; }
}
</style>`;

/** Apply once per media subtree, so an image inside a background image is not inverted twice. */
export function addDarkPageStyle(html: string): string {
  return /<\/head\s*>/i.test(html)
    ? html.replace(/<\/head\s*>/i, `${DARK_STYLE}</head>`)
    : `${DARK_STYLE}${html}`;
}
