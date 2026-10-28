# Reader rich blocks

Slice 4. Make technical pages read well: code blocks keep their language and
get syntax highlighting, Mermaid diagrams render, TeX that Defuddle misses
becomes MathML, callouts keep their look, and GitHub Gist embeds become code.
Builds on [slice 1](reader-fidelity.md) (sanitizer), [slice 2](reader-stored.md)
(stored Reader) and [slice 3](reader-browser.md) (rendered path).

## Principles

- Stored Reader HTML stays plain, sanitized structure. Decoration happens in
  the web at render time, so a library upgrade never needs a re-capture.
- Heavy libraries load only on pages that need them (dynamic `import()`), so
  ordinary articles pay nothing.
- Every new attribute is allowlisted with a strict value pattern in both
  sanitizers, and both sanitizer tables in the tests gain the same cases.

## 1. Code language

- Defuddle emits `<pre><code data-lang="…">`. Keep `data-lang` on `code` only,
  value `^[a-z0-9][a-z0-9+#._-]{0,23}$` (lowercased), in both sanitizers.
- Web: a small language label on the code block (Oat tokens, 12px, `--fnt`).

## 2. Syntax highlighting

- `shiki` (MIT) through its fine-grained core: `shiki/core`, the JavaScript
  regex engine (no WASM), and dynamic per-language imports for a fixed set:
  js, ts, jsx, tsx, json, html, css, scss, bash/shell, python, go, rust, java,
  kotlin, swift, ruby, php, c, cpp, csharp, sql, yaml, toml, markdown, diff,
  dockerfile, graphql. Unknown languages stay plain.
- Colors from a CSS-variables theme mapped to the Oat palette for light and
  dark (`docs/design/tokens.md`); no new hard-coded colors.
- Highlight after the prose is inserted, block by block (idle callback or
  `requestAnimationFrame` batches), never blocking first paint. Highlighted
  output is built from shiki tokens into spans with classes/vars the web
  owns; it is not raw HTML from the page.
- Record the measured lazy chunk size (gzip) in this file.

## 3. Mermaid

- `code[data-lang="mermaid"]` blocks render with `mermaid` (MIT), loaded by
  dynamic import only when such a block exists.
- `securityLevel: 'strict'`, `startOnLoad: false`, theme variables from Oat
  tokens, light and dark. Render each diagram with `mermaid.render` and insert
  the SVG only after DOMPurify (SVG profile, no `foreignObject`).
- A diagram that fails to parse stays a code block with a small "Diagram could
  not be rendered" note. A "Show source" toggle shows the code under a
  rendered diagram.
- Record the measured lazy chunk size (gzip).

## 4. More math

- After Defuddle, before sanitizing, in the worker (both static and rendered
  paths): convert TeX delimiters Defuddle left as text into MathML with
  `temml` (MIT; the same converter Defuddle's full build uses). Delimiters:
  `$$…$$`, `\[…\]`, `\(…\)`, and `$…$` only when the content holds a TeX
  command or `^`/`_` and no edge spaces (avoids prices such as "$5 and $10").
- Skip text inside `code`, `pre`, `kbd`, `samp`, and existing `math`.
- A TeX parse error leaves the original text.

## 5. Callouts

- Keep Defuddle's callout markers on `div`/`blockquote`: `data-callout`
  (`^[a-z-]{1,20}$`) and `data-callout-title` (plain text, max 200 chars).
- Web styles: note/info/tip/warning/danger/quote variants with Oat tokens; an
  icon from the existing icon set; unknown types fall back to note.

## 6. GitHub Gist embeds

- Static path: before Defuddle, replace each
  `script[src^="https://gist.github.com/"]` with a placeholder carrying the
  gist id (and `?file=` when present). After extraction, fetch
  `https://api.github.com/gists/<id>` through `safeFetch` (JSON accept), and
  replace the placeholder with one `<pre><code data-lang="…">` per file
  (language from the API, filename as a caption). Cap: 5 gists per page,
  200 KB of code per gist. On failure, a link to the gist.
- Rendered path: the same placeholder replacement runs in the page before
  Defuddle, so both paths store the same result.

## Versioning

`READER_VERSION` goes to 4 (stored HTML changes for items 1, 4, 5, 6).

## Verification

- Sanitizer tables (worker + web): `data-lang`, `data-callout`,
  `data-callout-title` allowed values kept, hostile values dropped, the
  attributes dropped on other elements.
- Web: highlighting applies to a known language and skips unknown ones;
  lazy chunks are not requested on a page without code/mermaid (assert with a
  module mock); mermaid strict mode, failure fallback, SVG sanitized
  (`<script>`/`onclick`/`foreignObject` removed); callout rendering.
- Worker: TeX delimiter conversion incl. the price false-positive case and
  skipped code; gist replacement with a mocked API, caps and failure link.
- Real pages: a Mermaid-heavy doc (e.g. mermaid.js.org syntax page or a GitHub
  README with mermaid), a KaTeX/MathJax page with `$` TeX, an Obsidian Publish
  page with callouts, a blog post with a gist, a code-heavy page (react.dev,
  MDN). Screenshot light and dark at desktop and 390px.
- Gate: `pnpm turbo run check-types test` + `pnpm quality`; web build size
  report before/after (main chunk must not grow by more than 5 KB gzip).
