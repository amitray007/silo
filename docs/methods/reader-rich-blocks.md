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

## Implementation verification (2026-10-28)

`READER_VERSION` is 4.

| Spec item | Status |
| --- | --- |
| 1. Code language | Done: strict attribute allowlist and 12px labels. |
| 2. Syntax highlighting | Done differently: all requested languages are supported; blocks above 200,000 characters remain plain to bound browser work. |
| 3. Mermaid | Done: lazy loading, strict mode, sanitized SVG, failure note and source disclosure. |
| 4. More math | Done: all four delimiter forms, price guard, skipped code/math, parse-error preservation. |
| 5. Callouts | Done: six variants, existing icons, unknown-type fallback. |
| 6. Gist embeds | Done: both paths, safeFetch, file selection, caps, captions and failure links. |

The catalog pins Shiki 4.5.0,
Mermaid 12.2.0 and Temml 0.14.0; `npm view <package> version license` reported
MIT for each package before installation.

Two capture fixes came from real-page checks. Code-language preparation also
reads wrapper classes and Sandpack's `sp-javascript` marker. Reader selection
keeps the static result when the rendered page loses Mermaid source. The
browser proxy now forwards and exposes the public `obs-status` response header,
which Obsidian Publish requires to read its page cache and options. It still
drops cookies and other response headers. Block MathML retains native
`display: block math` and the math font; an ordinary CSS block breaks equation layout.

### Bundle measurements

`pnpm --filter @silo/web build` measured the baseline. The final build used
`pnpm --filter @silo/web build --manifest --outDir /tmp/silo-rich-blocks/build-final`.
All sizes below are decimal KB gzip from Vite's build output. Manifest import
graphs identify the additional lazy chunks; the already loaded main bundle is
excluded from those totals.

| Output | Before | After |
| --- | ---: | ---: |
| Main JavaScript | 179.53 | 180.91 |
| CSS | 17.57 | 17.99 |
| Shiki core and JavaScript regex engine | 0 | 56.14 |
| Shiki including every supported language | 0 | 338.85 |
| Mermaid entry chunk | 0 | 30.28 |
| Mermaid entry and its static imports | 0 | 158.64 |
| Mermaid including every optional diagram/layout chunk | 0 | 1469.16 |

The main JavaScript increase is 1.38 KB gzip. Language grammars load separately
(e.g. JavaScript 16.62 KB and JSON 0.76 KB, plus their small import wrappers).
No Shiki WASM engine is used. Blocks above 200,000 characters stay plain to
bound synchronous tokenization work on the browser thread.

### Real pages

The capture harness ran `safeFetch`, `extractPage`, hardened `renderPage`, and
`selectReader` without writing to a database. The launcher used
`SILO_BROWSER_PORT=0 node packages/worker/src/browser/server.mjs`; each launcher
was stopped after capture. The web harness mounted the real `ReaderProse` in
repository Playwright Chromium. It captured static, rendered and selected HTML
in light/dark at 1440px and 390px. Publisher images were aborted in the web
harness; screenshots verify rich blocks, not image delivery.

| Page | Static / rendered / selected result | Example screenshot |
| --- | --- | --- |
| [MkDocs diagrams](https://squidfunk.github.io/mkdocs-material/reference/diagrams/) | Five Mermaid blocks / publisher removes source / static selected, five diagrams. Wide diagrams scroll inside a keyboard-focusable region. | [390px dark](/tmp/silo-rich-blocks/mermaid-selected-390-dark.png) |
| [MathJax](https://www.mathjax.org/) | Eight / eleven / eleven MathML expressions. Static extraction converts delimiters left by Defuddle. | [390px dark](/tmp/silo-rich-blocks/math-selected-390-dark.png) |
| [Obsidian Git](https://publish.obsidian.md/git-doc/Getting%20Started) | JS shell, no static Reader / two callouts / two callouts. Titles, icons and body text survive. | [390px dark](/tmp/silo-rich-blocks/callouts-selected-390-dark.png) |
| [Ghost Gist embed](https://diogoferreira.pt/how-to-embed-github-gists-on-a-ghost-blog/) | One expanded Gist in each path. Static and rendered HTML match. The API supplies no language for this file, so its code stays plain with a filename caption. | [390px dark](/tmp/silo-rich-blocks/gist-selected-390-dark.png) |
| [React Learn](https://react.dev/learn) | Twenty-four labeled and highlighted code blocks in each path. | [390px dark](/tmp/silo-rich-blocks/code-selected-390-dark.png) |

Screenshots: `/tmp/silo-rich-blocks/<page>-<mode>-<width>-<theme>.png`, where
`page` is `mermaid`, `math`, `callouts`, `gist` or `code`; `mode` is `static`,
`rendered` or `selected`; `width` is `1440` or `390`; and `theme` is `light` or
`dark`. Capture JSON, browser observations, build output and harness scripts
remain in `/tmp/silo-rich-blocks/`. No external share was created.

### Final checks

- `DATABASE_URL=postgres://silo:silo@localhost:5432/silo_unused TEST_DATABASE_URL=postgres://localhost:5432/postgres CI_REQUIRE_DB=1 CI_REQUIRE_BROWSER=1 pnpm turbo run check-types test`: 24 successful tasks, 3,589 tests passed, zero skips. Turbo reused 22 tasks; the worker's final run passed 780 tests and the web passed 1,185.
- `pnpm quality`: passed (Biome, boundaries, duplication and Knip). Warnings remain; no check was disabled.
- `node /tmp/silo-rich-blocks/qa.mjs`: 60 screenshots, no page-level JavaScript errors, no document overflow. The harness also asserts native block MathML layout.
- `git diff --check`: passed.
- The Unslop detector flags only repeated vocabulary in the file inventory; those paths are intentional.

All task-owned browsers and servers were closed. Ports 3000, 8787 and 8797 were
not bound. No commit, push, stash, reset, branch switch, worktree edit, database
capture write or external share was made.

### Changed files

```text
docs/methods/reader-rich-blocks.md
packages/core/src/capture.ts
packages/web/package.json
packages/web/src/components/reader/ReaderIcon.tsx
packages/web/src/components/reader/ReaderProse.tsx
packages/web/src/components/reader/decorateBlocks.test.tsx
packages/web/src/components/reader/decorateBlocks.ts
packages/web/src/components/reader/highlightCode.ts
packages/web/src/components/reader/renderDiagram.ts
packages/web/src/components/reader/rich-attributes.test.tsx
packages/web/src/components/reader/rich-blocks.test.tsx
packages/web/src/components/reader/shapeRichBlocks.ts
packages/web/src/styles/surfaces.css
packages/worker/package.json
packages/worker/src/browser/page.ts
packages/worker/src/browser/reader.integration.test.ts
packages/worker/src/browser/route.test.ts
packages/worker/src/browser/route.ts
packages/worker/src/extract/reader-content.ts
packages/worker/src/extract/reader-page.ts
packages/worker/src/extract/reader-thread.mjs
packages/worker/src/extract/rich-attributes.test.ts
packages/worker/src/extract/rich-blocks.test.ts
packages/worker/src/extract/rich-blocks.ts
packages/worker/src/fetch/safe-fetch.test.ts
packages/worker/src/fetch/safe-fetch.ts
packages/worker/src/reader/select-reader.test.ts
packages/worker/src/reader/select-reader.ts
pnpm-lock.yaml
pnpm-workspace.yaml
```
