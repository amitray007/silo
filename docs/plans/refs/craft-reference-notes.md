# Visual craft reference — target quality tier (from studying a peer bookmark app)

Notes captured from studying a structurally-similar bookmark app to raise silo's
UI to the same craft tier. **These are TECHNIQUES + measured values to inform
silo's OWN design — NOT a spec to pixel-clone another product.** silo keeps its
own palette, orb, marks, and name; we borrow the *finish techniques*.

## Measured tokens from the reference (warm deep-dark)
- **Body background:** `rgb(12, 6, 6)` — deep, slightly-warm near-black.
- **Surface / card:** `rgb(23, 17, 11)` — warm brown-black, one step up from bg.
- **Active nav item:** `rgb(39, 27, 22)` — subtle warm highlight (not amber).
- **Text (primary):** `rgb(241, 221, 197)` — warm cream/oat ON dark (NOTE: this is
  essentially silo's "Oat" cream, used as INK on a dark ground rather than as the
  ground itself — silo's existing palette is already most of the way here).
- **Border:** `rgb(127, 118, 105)` — warm gray, low-contrast.
- **Radii:** gentle, 8px+ on cards/surfaces.
- **Sidebar:** ~240px, transparent (sits directly on body bg, no panel fill).
- **Row height:** ~44px with generous vertical rhythm (rows breathe).

## THE key finish technique — hairline light-edge elevation
Every surface/card/popover carries:
```
box-shadow:
  inset 0 0 0 0.5px rgba(255,255,255,0.04),   /* faint inner top-light edge */
  0 0.5px 0 rgba(255,255,255,0.04);           /* faint outer bottom edge */
```
This is what makes surfaces feel like real material catching a soft top-light,
instead of flat bordered boxes. It's the single biggest "crafted" tell. Apply it
to silo's cards/popovers/menus/modal in the dark theme (tuned to silo's own bg).

## Layout / density observations
- **More vertical air** in list rows than silo currently uses — the list breathes.
- **Two-pane feel:** transparent sidebar + a content region; surfaces float on the
  deep bg with the hairline edge, not hard borders.
- Subtle **dotted texture** in the far corners of the bg (very low-contrast warm
  dots) — adds depth without noise. Optional, tasteful.
- **Glowing gradient orb** brand mark (radial orange glow) vs a flat dot.

## Richer source cards (silo ALREADY has this data — a rendering upgrade)
The reference's hover cards are richer than silo's current variants:
- **GitHub:** the real GitHub OG social-preview banner image (repo name + logo) as
  a white banner atop the card, THEN a stat row with iconography (used-by / ★ stars
  / forks) + a true multi-color language bar. silo currently shows bare numbers +
  an often-0% bar. silo already captures imageUrl (the OG image) + stars/forks —
  so this is rendering the data silo has better, not new data.
- **YouTube:** a large real video thumbnail filling the card top. silo has the
  thumbnail URL already (via the proxy) — render it bigger/edge-to-edge.

## What this means for silo (the honest read)
silo and the reference are structurally the SAME app; the gap is FINISH. silo's
existing warm "Oat" ramp + dark theme are already close in HUE — the work is:
1. Deepen + warm silo's DARK theme (make it the star): deeper bg, warm-black
   surfaces, cream ink, the hairline-edge elevation.
2. Open up spacing (more vertical air in rows + around surfaces).
3. Level up the source cards (real OG banner, icon stat rows, true language bar,
   bigger video thumb) — rendering data silo already fetches.
4. Motion + texture polish (subtle dotted bg texture, glowing orb, gentle easing).
All achievable with silo's OWN palette/identity — same feel, silo's own voice.
