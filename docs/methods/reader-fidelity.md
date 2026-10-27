# Reader fidelity: keep what Defuddle keeps

Stop silo's own sanitizer and styles from breaking Reader output that Defuddle
extracted correctly. This is slice 1 of 3. Slice 2 stores the Reader at
capture time with a "Refresh reader" row action. Slice 3 renders pages in a
sandboxed headless Chrome before Defuddle. Both get their own method files.

## Evidence (2026-10-28)

A scratch run of the current pipeline on 51 real URLs (outputs in
`/tmp/silo-reader-eval/`, scored against Chromium-rendered text):

- About 26 pages are clean. The rest fail for four reasons: (a) fetch blocked
  or JS-only, 8 pages; (b) extractor dropped content or kept junk, 10;
  (c) our sanitizer deleted structure, 6; (d) our CSS, 1 plus the image cases
  below.
- Defuddle 0.19.6 is the latest release. Readability 0.6.0 is not better
  overall: it wins on index pages and `<details open>`, and loses on
  LessWrong, GeeksforGeeks, HN, Fowler, MCP and Wikipedia tables. No other
  extractor clearly beats Defuddle (research packet, same date).
- Our linkedom shims in `reader-page.ts` match Defuddle's own
  `parseLinkedomHTML`. The parse setup is not a cause.

Causes this slice fixes, all in silo code:

1. **Math deleted.** Defuddle emits MathML (`<math data-latex>`). Neither
   allowlist (`reader-content.ts` `READER_TAGS`, `ReaderProse.tsx`) has MathML
   tags, so DOMPurify drops the element and its text. KaTeX docs fall from
   38,378 to 21,327 characters, Distill from 55,490 to 33,375. Wikipedia's
   Euler page reads "satisfies , and".
2. **Image sizes dropped.** Defuddle keeps `width` and `height`; both
   allowlists drop them. CSS then makes every image a centered block
   (`surfaces.css` `.silo-reader-prose img`). Badges, emoji and small icons
   render big and on their own lines; an SVG with only a `viewBox` stretches
   to the column width.
3. **Embeds deleted.** Defuddle keeps `iframe` (YouTube, Vimeo, CodePen). The
   allowlists drop them. Troy Hunt's post is a YouTube video and renders
   empty; css-tricks loses 18 CodePen demos.
4. **`<details>` collapsed.** Defuddle drops the `open` attribute, so
   css-tricks renders as seven closed sections.
5. **Wide tables squeezed.** `:is(th, td) { min-width: 100px }` inside a
   `width: 100%` table squeezes a 14-column Wikipedia table until one row is
   about 400px tall.
6. **Bare fetch headers.** `safe-fetch.ts` sends only `user-agent`. web.dev
   answered in Portuguese with no `Accept-Language`.

## Changes

1. **MathML (worker + web).** Add the MathML presentation elements to both
   allowlists: `math, mrow, mi, mn, mo, ms, mtext, mspace, msup, msub,
   msubsup, mfrac, msqrt, mroot, mover, munder, munderover, mtable, mtr, mtd,
   mstyle, mpadded, mphantom, menclose, semantics, annotation`. Allow the
   attributes `display, mathvariant, displaystyle, scriptlevel, stretchy,
   fence, separator, accent, accentunder, columnalign, rowalign, columnspan,
   rowspan, lspace, rspace`. No `href` on MathML elements, no
   `annotation-xml`. Browsers render MathML natively; add minimal CSS
   (`math[display="block"]` gets block margin and horizontal scroll).
2. **Image sizes (worker + web).** Allow `width` and `height` on `img` only,
   and keep them only when they are integers from 1 to 4000. CSS keeps
   `max-width: 100%; height: auto`, so the attributes set the size and the
   aspect ratio, never overflow.
3. **Inline small images (web).** In `markViewable`, an image whose natural
   width and height are both under 64px, or whose declared `height` is 32 or
   less, gets `data-inline="true"`: `display: inline; margin: 0;
   vertical-align: middle; border-radius: 0`. An image whose `alt` is a
   single emoji gets `height: 1.2em; width: auto`. A row of badges then stays
   one row.
4. **Embeds (worker + web).** The worker turns each `iframe` with an http(s)
   `src` into `<figure data-silo-embed><a href="{src}">{host}</a></figure>`,
   resolved and checked by the existing `httpUrl`. Allow only the
   `data-silo-embed` attribute (both sides). The web passes each href through
   `embedFor`: a known provider becomes the same sandboxed iframe the reader
   players use (`src` from `embedFor`, never from the page). Anything else
   stays a link with the host name, so the reader sees that something was
   there.
5. **Details (worker).** After sanitizing, set `open` on a `<details>` whose
   text outside its `summary` is at least 280 characters. Short boxes (MDN's
   "Baseline" note) stay closed.
6. **Tables (web CSS).** Tables get `width: max-content; min-width: 100%`
   inside the existing scroll wrapper; cells keep `min-width: 100px` and add
   `max-width: 40ch`. A long cell wraps at 40ch instead of 100px.
7. **Fetch headers (worker).** `safeFetch` also sends
   `accept: text/html,application/xhtml+xml,*/*;q=0.8` and
   `accept-language: en-US,en;q=0.9`. The user agent stays.

## Out of scope (recorded for later slices)

- Fetch blocks (Medium, NYT, realpython, Ars, Notion): slice 3.
- Dropped lead images (Verge, dev.to, Cloudflare) and index pages (BBC):
  extractor behavior; revisit after slice 3 with a rendered DOM.
- Content-image index drift between fetches (1 in 39): slice 2 removes it.
- Defuddle open issues #441, #445, #408: track upstream; no local fork.

## Verification

- Unit tests per change: MathML survives both passes; `width`/`height` kept in
  range and dropped outside it; iframe becomes the embed figure, `javascript:`
  and relative junk dropped; `data-silo-embed` is the only data attribute
  kept; `details` opens by the 280-character rule; fetch sends the headers.
- Security: an `iframe src` from the page never reaches the DOM; only
  `embedFor` output does. MathML with `href`, `xlink:href` or
  `annotation-xml` is stripped. Add these cases to the sanitizer tests.
- Rerun the 51-URL scratch comparison. Expected: KaTeX and Distill text
  recall back near raw Defuddle, Euler formulas visible, Troy Hunt shows a
  player, css-tricks sections open, Wikipedia comparison rows near natural
  height, web.dev in English. Screenshot those six in the running app.
- `pnpm install` first: `packages/worker/node_modules` lacks `defuddle`,
  `dompurify` and `linkedom`. Then `pnpm turbo run check-types test` and
  `pnpm quality`.
