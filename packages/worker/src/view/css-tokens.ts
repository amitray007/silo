/** Narrow CSS scanner: strings, escapes and URLs are atomic, including their punctuation. */
export type CssToken = {
  kind: 'name' | 'at' | 'string' | 'url' | 'space' | 'symbol';
  raw: string;
  value: string;
};
const SPACE = /[\t\n\f\r ]/;
const NAME = /[\w\u0080-\uffff-]/;

function cssEscape(css: string, start: number): { value: string; end: number } {
  const rest = css.slice(start + 1);
  const hex = /^[a-f\d]{1,6}/i.exec(rest)?.[0];
  if (hex) {
    const code = Number.parseInt(hex, 16);
    const end = start + 1 + hex.length;
    const whitespace =
      css[end] === '\r' && css[end + 1] === '\n' ? 2 : SPACE.test(css[end] ?? '') ? 1 : 0;
    return {
      value: String.fromCodePoint(
        code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : code,
      ),
      end: end + whitespace,
    };
  }
  const newline = /^(?:\r\n|[\n\r\f])/.exec(rest)?.[0];
  return { value: newline ? '' : (rest[0] ?? '\ufffd'), end: start + 1 + (newline?.length ?? 1) };
}

function quoted(css: string, start: number): { value: string; end: number } {
  let value = '';
  let end = start + 1;
  while (end < css.length && css[end] !== css[start]) {
    if (/[\n\r\f]/.test(css[end] ?? '')) return { value, end };
    if (css[end] === '\\') {
      const escaped = cssEscape(css, end);
      value += escaped.value;
      end = escaped.end;
    } else {
      value += css[end++];
    }
  }
  return { value, end: Math.min(end + 1, css.length) };
}

function trivia(css: string, start: number): number {
  let end = start;
  for (;;) {
    if (SPACE.test(css[end] ?? '')) end++;
    else if (css.startsWith('/*', end)) {
      const close = css.indexOf('*/', end + 2);
      end = close < 0 ? css.length : close + 2;
    } else return end;
  }
}

function urlValue(css: string, start: number): { value: string; end: number } {
  let end = trivia(css, start);
  let value = '';
  if (css[end] === '"' || css[end] === "'") {
    const string = quoted(css, end);
    value = string.value;
    end = trivia(css, string.end);
  } else {
    const bare = bareUrl(css, end);
    value = bare.value;
    end = bare.end;
  }
  // Invalid URLs fail closed; never leave their original spelling active.
  if (css[end] !== ')') {
    const close = css.indexOf(')', end);
    return { value: '', end: close < 0 ? css.length : close + 1 };
  }
  return { value, end: end + 1 };
}

function bareUrl(css: string, start: number): { value: string; end: number } {
  let end = start;
  let value = '';
  while (end < css.length && css[end] !== ')') {
    if (css.startsWith('/*', end)) end = trivia(css, end);
    else if (css[end] === '\\') {
      const escaped = cssEscape(css, end);
      value += escaped.value;
      end = escaped.end;
    } else value += css[end++];
  }
  return { value: value.trim(), end };
}

function name(css: string, start: number): { value: string; end: number } {
  let value = '';
  let end = start;
  while (end < css.length) {
    if (css[end] === '\\') {
      const escaped = cssEscape(css, end);
      value += escaped.value;
      end = escaped.end;
    } else if (NAME.test(css[end] ?? '')) value += css[end++];
    else break;
  }
  return { value, end };
}

function nextToken(css: string, start: number): { token: CssToken; end: number } {
  const skipped = trivia(css, start);
  if (skipped > start) return { token: { kind: 'space', raw: ' ', value: ' ' }, end: skipped };
  const char = css[start] ?? '';
  if (char === '"' || char === "'") {
    const string = quoted(css, start);
    return {
      token: { kind: 'string', raw: css.slice(start, string.end), value: string.value },
      end: string.end,
    };
  }
  return identToken(css, start);
}

function identToken(css: string, start: number): { token: CssToken; end: number } {
  const char = css[start] ?? '';
  const at = char === '@';
  const ident = name(css, start + Number(at));
  if (ident.end === start + Number(at)) {
    return { token: { kind: 'symbol', raw: char, value: char }, end: start + 1 };
  }
  const open = trivia(css, ident.end);
  if (!at && ident.value.toLowerCase() === 'url' && css[open] === '(') {
    const url = urlValue(css, open + 1);
    return {
      token: { kind: 'url', raw: css.slice(start, url.end), value: url.value },
      end: url.end,
    };
  }
  return {
    token: { kind: at ? 'at' : 'name', raw: css.slice(start, ident.end), value: ident.value },
    end: ident.end,
  };
}

export function cssTokens(css: string): CssToken[] {
  const tokens: CssToken[] = [];
  let end = 0;
  while (end < css.length) {
    const next = nextToken(css, end);
    tokens.push(next.token);
    end = next.end;
  }
  return tokens;
}

export type CssImport = { start: number; end: number; target: string; media: string };

function importEnd(tokens: CssToken[], start: number): number {
  let depth = 0;
  let end = start;
  while (end < tokens.length) {
    const next = tokens[end];
    if (next?.kind === 'symbol') {
      if (depth === 0 && [';', '{', '}'].includes(next.value)) break;
      if (['(', '['].includes(next.value)) depth++;
      if ([')', ']'].includes(next.value)) depth = Math.max(0, depth - 1);
    }
    end++;
  }
  return end;
}

/** Include malformed imports too, so callers can remove every import at the depth boundary. */
export function cssImports(tokens: CssToken[]): CssImport[] {
  const imports: CssImport[] = [];
  for (let start = 0; start < tokens.length; start++) {
    const token = tokens[start];
    if (token?.kind !== 'at' || token.value.toLowerCase() !== 'import') continue;
    const end = importEnd(tokens, start + 1);
    let first = start + 1;
    while (tokens[first]?.kind === 'space') first++;
    const target = tokens[first];
    const valid = target?.kind === 'url' || target?.kind === 'string';
    imports.push({
      start,
      end: tokens[end]?.value === ';' ? end + 1 : end,
      target: valid ? target.value : '',
      media: tokens
        .slice(first + 1, end)
        .map((part) => part.raw)
        .join('')
        .trim(),
    });
    start = end;
  }
  return imports;
}

export function replaceCssImports(css: string, replacements: (rule: CssImport) => string): string {
  const tokens = cssTokens(css);
  const imports = cssImports(tokens);
  let cursor = 0;
  let output = '';
  for (const rule of imports) {
    output +=
      tokens
        .slice(cursor, rule.start)
        .map((token) => token.raw)
        .join('') + replacements(rule);
    cursor = rule.end;
  }
  return (
    output +
    tokens
      .slice(cursor)
      .map((token) => token.raw)
      .join('')
  );
}
