# Live tab resilience

Make the Live tab load once without flicker, show pages that hide content until
their scripts run, and give every unavoidable failure a useful way out. Add a
real-site check so new failure classes show up before users find them.

## Evidence (2026-10-26, `silo_reader_qa`, 31 links)

- **Flicker:** clicking a link records three states: "Preparing page..."
  skeleton (hint fetch and `HEAD /view` check), then a different
  "Loading page..." skeleton mounted inside `PageFrame`, then the page. The
  skeleton unmounts and remounts once, and the spinner restarts.
- **GeeksforGeeks** (`https://www.geeksforgeeks.org/techtips/how-to-enable-google-chrome-reader-mode/`):
  CSP `frame-ancestors 'self'`, so mode `view`. The silo view is blank white:
  `#__next > div[style="visibility:hidden;background-color:#ffffff;min-height:100vh"]`
  wraps the whole page, and only the site's script removes it. Visible text
  0 of 6,395 characters.
- **Linear Method:** silo view shows the hero only (898 characters); the rest is
  rendered by scripts. No static fix exists.
- The other 11 `view` pages show most of their text. Direct pages load with no
  `sandbox`, so a frame-busting script can navigate silo itself away.
- The "Show silo view" manual switch from decision 1 was removed on request,
  so a page that frames but renders blank has no escape today.

## Changes

1. **One loading surface (web).** `Original` renders one surface for
   `direct` and `view` modes. A single `PageSkeleton` overlay stays mounted
   from the hint fetch until the iframe `load` event (or the 12 s timeout),
   then fades out (`opacity` 150 ms, none under reduced motion). The iframe
   mounts under the overlay as soon as the mode is known. One label:
   "Loading page...". Players keep `PlayerSkeleton`.
2. **Reveal script-gated content (worker transform).** In `sanitizePageDom`,
   before DOMPurify:
   - Strip `visibility:hidden`, `opacity:0` and `display:none` declarations
     from the inline `style` of `html`, `body`, and any element whose text is
     at least 50% of the body text (and at least 200 characters). Remove the
     `hidden` attribute from those elements too.
   - Append a final `<style>` that sets `html, body` to
     `visibility: visible !important; opacity: 1 !important` and `body` to
     `display: block !important`. This covers anti-flicker classes such as
     `.async-hide` and `body{display:none}` anti-clickjacking styles.
   - Add a class `silo-view-shown` to those large-text elements; the same
     style sets `.silo-view-shown.silo-view-shown` visible and opaque with
     `!important`, which beats class-based gates.
   - Keep tabs, menus and other small hidden elements hidden.
3. **Thin-page detection (worker).** After the transform, if the body text
   (excluding `nav`, `header`, `footer`, `aside`) has fewer than 200
   characters, `hintFor` returns `{ mode: 'none', reason: 'needs-script' }`
   instead of `view`.
4. **Useful fallback (web).** The card keeps the title and description and
   adds two actions: "Show Reader" (switches to the Reader tab) and
   "Open in new tab". Use the existing button styles. Reason text maps:
   `needs-script` -> "This page needs its own scripts to display.",
   fetch failures -> "Silo could not load this page.", others keep
   "This content cannot be displayed here."
5. **Sandbox direct frames (web).** Direct iframes get
   `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"`.
   No `allow-top-navigation`, so a page cannot navigate silo away. Players
   are out of scope.
6. **Real-site check (script).** `scripts/check-live.mjs` with
   `pnpm check:live [urls-file]`: for each URL, run the worker's fetch and
   transform, render the result in Playwright Chromium (the same CSP sandbox
   header as `/view`), and print mode, visible text, total text and ratio.
   Exit non-zero when a `view` page shows under 25% of its text or under 200
   visible characters. Ship `scripts/live-sites.txt` with the 31 QA URLs plus
   GfG. Network access is required, so it is a manual check, not CI.

## Tests

- Transform: inline `visibility:hidden` wrapper holding the article is
  revealed; a small hidden menu stays hidden; `.async-hide` on `html` is
  overridden; `body{display:none}` is overridden.
- Hint: a page with 50 characters of body text returns `needs-script`.
- Web: one skeleton node persists from preparing through frame load (assert the
  same element), card actions call the Reader switch and open the URL, direct
  iframe has the sandbox tokens.

## Out of scope

Running page scripts on the server (headless rendering) and the old manual
mode switch.
