import { createPortal } from 'react-dom';
import type { LinkJson } from '../api/types';
import { relativeTimeFromNow } from '../lib/relativeTime';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';

/** Where the popover is pinned — `useHoverPreview` computes this from the hovered row's bounding rect, already clamped to the viewport (v3's `pvTop`/`pvLeft`). */
export type HoverPreviewPosition = { top: number; left: number };

/**
 * The `pvOpen` fixed popover (plan 011, V3-8 — `Silo-v3.html:207-277`),
 * **generic variant only**: title, an optional `#tag #tag` line, an optional
 * italic quoted note, then the shared footer (`domain · meta` + `open ↗`).
 * The rich variants (`pvIsVideo`/`pvIsRepo`/`pvIsTweet`/`pvIsHn`) are PARKED —
 * they render stats/thumbnails/author text sourced from plugin data
 * (GitHub stars, tweet body, HN points, a video thumbnail + channel) that
 * doesn't exist anywhere in `LinkJson` today. Building them now would mean
 * inventing fake numbers, which plan 011 explicitly rules out ("keep it
 * honest — don't fake plugin data"); they return once the plugin system
 * lands real per-source data to back them.
 *
 * `pvMeta` in v3 is a pre-baked mock `time`/`left` string; `LinkJson` has no
 * such field, so this derives an honest equivalent from `createdAt`
 * (`relativeTimeFromNow` — see that module's doc comment for why the mock's
 * exact phrasing isn't reproducible field-for-field).
 *
 * Rendered via a PORTAL to `document.body` (not inline in the row) so
 * `position:fixed` at `z-index:36` is never clipped by a scrolling list's
 * `overflow`/stacking context — `useHoverPreview` owns the single shared
 * instance (mounted once in `AppFrame`, mirroring `RowMenuProvider`'s "one
 * provider, not one per row" shape) so at most one preview is ever open.
 *
 * `onMouseEnter`/`onMouseLeave` call the caller's `keep`/`hide` (v3's
 * `pvKeep`/`pvHide`) so moving the pointer FROM the row INTO the card (e.g.
 * to click `open ↗`) cancels the pending close instead of racing it.
 */
export function HoverPreview({
  link,
  position,
  onKeep,
  onHide,
}: {
  link: LinkJson;
  position: HoverPreviewPosition;
  onKeep: () => void;
  onHide: () => void;
}) {
  const domain = deriveDomain(link.url);
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const hasTags = link.tags.length > 0;
  const tagLine = link.tags.map((t) => `#${t}`).join('  ');
  const hasNote = !!link.notes;
  const meta = relativeTimeFromNow(link.createdAt);

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-hover handoff only (v3's `pvKeep`/`pvHide`) — every actual control inside (the `open ↗` anchor, the ✕ close button) is independently keyboard-operable; this wrapper just extends the hover region onto the card itself.
    <div
      className="silo-popover"
      onMouseEnter={onKeep}
      onMouseLeave={onHide}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 288,
        zIndex: 36,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        boxShadow: '0 24px 60px -24px rgba(40,28,8,.5)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        // The card is placed to the RIGHT of the hovered row
        // (`computePosition` in HoverPreviewContext.tsx: `rect.right + 14`),
        // so it grows from its own left edge — the edge nearest the row it's
        // previewing — not its center (review-animations-STANDARDS.md's
        // origin-aware rule).
        transformOrigin: 'left center',
      }}
    >
      <button
        type="button"
        title="close"
        aria-label="close preview"
        onClick={onHide}
        className="silo-icon-btn-sm"
        style={{
          position: 'absolute',
          top: 9,
          right: 9,
          border: 0,
          background: 'none',
          fontFamily: 'inherit',
          fontSize: '0.72rem',
          lineHeight: 1,
          color: 'var(--ghost)',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 6,
        }}
      >
        ✕
      </button>
      <div style={{ padding: '13px 26px 2px 14px' }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>
          {title}
        </div>
        {hasTags && (
          <div style={{ fontSize: '0.76rem', color: 'var(--ghost)', marginTop: 6 }}>{tagLine}</div>
        )}
        {hasNote && (
          <div
            style={{
              fontSize: '0.78rem',
              color: 'var(--mut)',
              fontStyle: 'italic',
              marginTop: 6,
            }}
          >
            "{link.notes}"
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px 11px',
          marginTop: 9,
          borderTop: '1px solid var(--line)',
          fontSize: '0.72rem',
          color: 'var(--ghost)',
        }}
      >
        <span>{domain}</span>
        <span>·</span>
        <span>{meta}</span>
        <span style={{ flex: 1 }} />
        <a
          href={link.url}
          target="_blank"
          rel="noopener"
          className="silo-edit-footer-btn"
          style={{
            color: 'var(--fnt)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          open ↗
        </a>
      </div>
    </div>,
    document.body,
  );
}
