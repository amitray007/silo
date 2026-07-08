import { useEffect, useState } from 'react';
import type { LinkJson } from '../api/types';
import { isHoverCapable } from '../lib/pointer';
import { relativeTimeFromNow } from '../lib/relativeTime';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import { Chip } from './Chip';
import { EnrichingLoader } from './EnrichingLoader';
import { useHoverPreview } from './HoverPreviewContext';
import { RowMenu } from './RowMenu';
import { useRowMenu } from './RowMenuContext';
import { RowSelectCheckbox } from './RowSelectCheckbox';
import { useLibrarySelection } from './SelectionContext';

/**
 * The Library row (plan 010 — `Silo-v2.html:110-136`, `render-rows-*.png`;
 * write chrome added plan 011 V3-4; multi-select added V3-5). The whole row
 * is a link out to `link.url`; the `⋯` button (always rendered, ghost→ink on
 * hover, matching v3) opens `RowMenu` for THIS row via the shared
 * `useRowMenu()` context — see `RowMenuContext.tsx`'s doc comment for why the
 * open/edit state lives there rather than per-route. The `⋯` button's
 * `onMouseDown` stops propagation so the click never reaches the row's `<a>`
 * (no accidental navigation) before `onClick` toggles the menu; the outer
 * wrapping `<span>` is `position: relative` so `RowMenu`'s
 * `position:absolute` anchors to this row, not the whole list.
 *
 * Right-click (`onContextMenu`, `handleContextMenu` below) opens the SAME
 * menu via the SAME `toggleMenu` call as the `⋯` button — a build-brief
 * request so the row's options are reachable without hunting for the
 * trigger button. `preventDefault` suppresses the browser's own native
 * context menu (which would otherwise show a redundant "open link in new
 * tab / copy link" list one layer below this app's own). A right-click also
 * dismisses any pending/showing hover preview for this row first (mirrors
 * the `⋯` button's own `useEffect` below) since the two popovers would
 * otherwise fight for the same on-screen space.
 *
 * Marks: per a direct user-feedback polish pass, the inline `¶`/`◆`
 * glyphs (note / added-by-Claude) are REMOVED from the row entirely — rows
 * show chip + title + domain only, no status chrome, for `full`/`partial`/
 * `bare` rows. The quoted note LINE underneath (when `link.notes` is set)
 * stays; only the glyph badge next to the title is gone. `Mark`/`MarkKind`
 * are deleted (unused after this — see `docs/rules/testing.md`/knip).
 *
 * Live enrichment loading chrome (plan 014): reintroduces ONE piece of
 * per-row status chrome — the `◌ capturing` pulse — but ONLY while
 * `link.captureStatus === 'enriching'`. This isn't a reversal of the mark
 * removal above (those were permanent, settled-state badges on
 * full/partial/bare rows); this is a transient IN-PROGRESS indicator that
 * "silence means complete" explicitly carves out room for — it disappears
 * the instant the row settles to any other status. Matches v3's per-row
 * status span (`Silo-v3.html:123`): `◌` (the sanctioned incomplete mark)
 * + "capturing", `color: var(--markt)`, `font-size: .76rem`,
 * `font-weight: 500`, pulsing via the EXISTING `siloPulse` keyframe
 * (`base.css:738`) reused via inline style (not a new keyframe). Only
 * `enriching` pulses — `partial`/`bare` (v3's "degraded") intentionally show
 * no chrome here; wiring a non-pulsing degraded mark is a follow-up (plan
 * 014 scope note), not part of this slice.
 *
 * Hover meta: on hover (or focus), a relative-time string ("2h ago") derived
 * from `createdAt` renders on the right, next to the domain — v3's `it.meta`
 * (`Silo-v3.html:127-129`), restored per user feedback.
 *
 * Rich line (plan 012 phase 2 — v3's `it.hasRich`/`it.rich`,
 * `Silo-v3.html:132-134`): un-parked for Hacker News links only — a
 * `▲{points} points · {comments} comments` line under the title row, in
 * `--ghost` (v3's `richColor` for the HN case), rendered when
 * `link.sourceData.kind === 'hacker_news'`. GitHub/YouTube sourceData carry
 * no row-level rich line in v3 — their richness is hover-preview-only (see
 * `HoverPreview.tsx`'s `RepoVariant`/`VideoVariant`).
 *

 * Multi-select: hovering (or having the `⋯` menu open, or any row already
 * selected) swaps the chip for a checkbox — `hovered` is tracked locally
 * (needed for that content swap; the row's OWN hover background stays pure
 * CSS, `.silo-link-row:hover` in `base.css`, since inline styles can't do
 * `:hover` — this local flag also drives the hover-meta/chip swap). A
 * selected row keeps the `--hov` background even when not hovered (v3's
 * `bg: (hov || isSel) ? 'var(--hov)' : 'transparent'`), applied as an inline
 * override on top of the CSS default.
 */
export function LinkRow({ link }: { link: LinkJson }) {
  const domain = deriveDomain(link.url);
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const { openMenuId, toggleMenu } = useRowMenu();
  const menuOpen = openMenuId === link.id;
  const [hovered, setHovered] = useState(false);
  const selection = useLibrarySelection();
  const isSelected = selection.isSelected(link.id);
  const showCheck = hovered || menuOpen || selection.selected.length > 0;
  const { scheduleShow, scheduleHide, dismiss } = useHoverPreview();

  // The hover-preview trigger (plan 011, V3-8 — v3's `it.enter`/`it.leave`,
  // `Silo-v3.html:808-823`). Suppressed (no preview scheduled at all, not
  // scheduled-then-hidden) whenever THIS row's `⋯` menu is open — a preview
  // popping up behind/beside an open menu would fight it for the same screen
  // real estate for no benefit — or the pointer isn't hover-capable (a tap on
  // a touch device is not a "hover", and there is no pointer to later "leave"
  // and close it). `enter` reads `menuOpen` fresh each call (not captured at
  // mount) since it's a plain closure recreated every render, matching v3's
  // own per-render `enter` closure.
  const handleEnter = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    setHovered(true);
    if (menuOpen || !isHoverCapable()) return;
    scheduleShow(link, e.currentTarget.getBoundingClientRect());
  };
  const handleLeave = () => {
    setHovered(false);
    scheduleHide(link.id);
  };

  // Opening this row's `⋯` menu (the button's own `onClick`, which
  // `stopPropagation`s and so never fires the anchor's `onMouseLeave`) must
  // still dismiss an already-showing/pending preview for this row — the menu
  // popover and the hover-preview card both anchor near the same row and
  // would otherwise overlap on screen. `scheduleHide` is a no-op if no
  // preview is showing/pending for this id, so this is safe to call
  // unconditionally whenever `menuOpen` flips true.
  useEffect(() => {
    if (menuOpen) scheduleHide(link.id);
  }, [menuOpen, scheduleHide, link.id]);

  // Unmount cleanup (review fix, ce-correctness + ce-julik-frontend-races): a
  // row can disappear with no `mouseLeave` ever firing — trashed via the
  // `⋯` menu, or simply filtered out of the list by a query refetch/edit
  // while still hovered. Without this, either an already-scheduled SHOW timer
  // fires later and pops a preview open for a link no longer in the list, or
  // an already-OPEN preview keeps showing this link's stale
  // title/tags/notes (or its trashed content) until the user happens to
  // move the pointer elsewhere. `dismiss` is immediate (no hide delay) and a
  // safe no-op if this row's preview isn't the pending/showing one — see
  // `HoverPreviewContext.tsx`'s doc comment on `dismiss`. Deliberately a
  // SEPARATE effect from the `menuOpen` one above (different trigger,
  // different semantics: that one still honors the hide delay via
  // `scheduleHide`; this one is unmount-only and bypasses it).
  useEffect(() => () => dismiss(link.id), [dismiss, link.id]);

  // Right-click opens the SAME `⋯` menu as the button (user-feedback request)
  // — suppress the browser's native context menu and reuse `toggleMenu`
  // (never a bespoke "open" call) so right-click and the `⋯` button share one
  // toggle path: right-clicking an already-open row's menu closes it, exactly
  // like clicking `⋯` again would. A right-click on a plain `<a>` would
  // otherwise show the browser's own "open link in new tab / copy link"
  // menu — which duplicates this app's own menu one layer down, so it's
  // suppressed here in favor of ours.
  const handleContextMenu = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    scheduleHide(link.id);
    toggleMenu(link.id);
  };

  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener"
        className="silo-link-row"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        onContextMenu={handleContextMenu}
        style={isSelected ? { background: 'var(--hov)' } : undefined}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          <RowSelectCheckbox
            visible={showCheck}
            isSelected={isSelected}
            onToggle={() => selection.toggle(link.id)}
          />
          {!showCheck &&
            (link.captureStatus === 'enriching' ? <EnrichingLoader /> : <Chip domain={domain} />)}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--s2-5)',
            }}
          >
            <span
              style={{
                fontWeight: 500,
                fontSize: 'var(--text-base)',
                color: link.captureStatus === 'enriching' ? 'var(--fnt)' : 'var(--ink)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </span>
            {/* Enriching rows show NO status chrome (user-picked, reference-
                studied): just favicon + title + domain, identical to a settled
                row. The title is the URL until live polling (plan 014) fills in
                the real one. The old ◌ Capturing pulse chip was removed. */}
            {/* The domain suffix is hidden WHILE enriching: the title is the
                full URL then, which already contains the domain — showing both
                is redundant (user feedback). Once enriched, the title becomes
                the real page title and the domain suffix returns, distinct. */}
            {link.captureStatus !== 'enriching' && (
              <span
                style={{
                  flex: 'none',
                  maxWidth: '14rem',
                  fontSize: 'var(--text-base)',
                  color: 'var(--fnt)',
                  fontWeight: 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {domain}
              </span>
            )}
          </span>
          {/* The hover-revealed relative time sits at the row's RIGHT end,
              just before the ⋯ options button (user feedback: beside options,
              not beside the link title). `flex:none` + a small right gap keep
              it from pushing the button; it reveals via the fade class. */}
          {hovered && (
            <span
              className="silo-row-reveal"
              style={{
                flex: 'none',
                fontSize: 'var(--text-xs)',
                color: 'var(--fnt)',
                whiteSpace: 'nowrap',
                marginRight: 'var(--s1)',
              }}
            >
              {relativeTimeFromNow(link.createdAt)}
            </span>
          )}
          <button
            type="button"
            title="Options"
            aria-label="Options"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleMenu(link.id);
            }}
            style={{
              flex: 'none',
              display: 'grid',
              placeItems: 'center',
              // K5 (oat-conformance audit): this button never paints a
              // background (color-only ghost→ink feedback, no hover fill —
              // see the `color` line below), so growing the box itself to
              // the ≥40px touch-target floor (`var(--s10)`) is visually
              // identical to the old 28px box — only the glyph's own
              // fontSize governs its apparent size, and that's unchanged.
              // A negative margin keeps the row's own layout from shifting
              // (the extra hit area extends into surrounding whitespace, not
              // into sibling content — this button is `flex: 'none'` at the
              // row's end).
              width: 'var(--s10)',
              height: 'var(--s10)',
              margin: 'calc(-1 * var(--s1-5))',
              border: 0,
              borderRadius: 6,
              background: 'none',
              fontSize: '0.9rem',
              lineHeight: 1,
              color: menuOpen ? 'var(--ink)' : 'var(--ghost)',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'inherit',
              fontWeight: 500,
              transform: 'scale(1)',
              transition:
                'color 0.14s ease, background 0.14s ease, transform 0.12s var(--ease-out)',
            }}
          >
            ⋯
          </button>
        </span>
        {link.sourceData.kind === 'hacker_news' && (
          <span
            style={{
              display: 'block',
              // Left inset aligns this sub-line's text under the TITLE. These
              // sub-lines are direct children of the `.silo-link-row` <a>, so
              // they already sit inside its --s2-5 padding; --row-inset is
              // measured from the row's OUTER edge, so subtract that padding
              // here to avoid double-counting it (title = row-pad + chip + gap;
              // this = the same, expressed relative to the already-padded box).
              padding: 'var(--s-0-5) var(--s5) 0 calc(var(--row-inset) - var(--s2-5))',
              fontSize: '0.78rem',
              color: 'var(--fnt)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {link.sourceData.points} points · {link.sourceData.comments} comments
          </span>
        )}
        {link.notes && (
          <span
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              // Left inset aligns this sub-line's text under the TITLE. These
              // sub-lines are direct children of the `.silo-link-row` <a>, so
              // they already sit inside its --s2-5 padding; --row-inset is
              // measured from the row's OUTER edge, so subtract that padding
              // here to avoid double-counting it (title = row-pad + chip + gap;
              // this = the same, expressed relative to the already-padded box).
              padding: 'var(--s-0-5) var(--s5) 0 calc(var(--row-inset) - var(--s2-5))',
              fontSize: '0.8rem',
              color: 'var(--mut)',
              fontStyle: 'italic',
              maxWidth: '48ch',
            }}
          >
            "{link.notes}"
          </span>
        )}
      </a>
      {menuOpen && <RowMenu link={link} />}
    </span>
  );
}
