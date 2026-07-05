import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LinkJson, SourceData } from '../api/types';
import { previewImageUrl } from '../lib/previewImage';
import { relativeTimeFromNow } from '../lib/relativeTime';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';

/** Where the popover is pinned — `useHoverPreview` computes this from the hovered row's bounding rect, already clamped to the viewport (v3's `pvTop`/`pvLeft`). */
export type HoverPreviewPosition = { top: number; left: number };

type HackerNewsSourceData = Extract<SourceData, { kind: 'hacker_news' }>;
type GithubSourceData = Extract<SourceData, { kind: 'github' }>;
type YoutubeSourceData = Extract<SourceData, { kind: 'youtube' }>;

/**
 * The `pvIsHn` variant (`Silo-v3.html:263-271`): title, then a line with
 * `▲ {points} points` in `--markt` (the amber-adjacent data-viz accent v3
 * uses for this exact stat — not button/chrome fill, so it's within the
 * "amber only as brand dot + status marks" rule) and `{comments} comments`
 * in `--fnt`.
 */
function HnVariant({ title, sourceData }: { title: string; sourceData: HackerNewsSourceData }) {
  return (
    <div style={{ padding: '13px 14px 2px' }}>
      <div style={{ fontSize: '0.84rem', fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 7 }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--markt)' }}>
          ▲ {sourceData.points} points
        </span>
        <span style={{ fontSize: '0.76rem', color: 'var(--fnt)' }}>
          {sourceData.comments} comments
        </span>
      </div>
    </div>
  );
}

/**
 * The `pvIsRepo` (GitHub) variant (`Silo-v3.html:218-240`): title +
 * description, a stats row (v3's `pvStats` loop — we render stars/forks/
 * issues; `contributors` isn't in our `SourceData` shape, so it's omitted
 * rather than faked), then a thin language bar (`--mark` fill for the
 * language %, `--line` for the rest) + the language name. v3 also shows a
 * favicon chip next to the title — omitted here (no per-repo image data;
 * the shared footer already carries the domain).
 *
 * `languagePct` may be absent (the GitHub enricher degrades gracefully when
 * `/languages` fails) — the bar still renders at 0% fill rather than v3's
 * mocked 70% fallback, since a real 0% is honest and a fabricated 70% isn't.
 */
function RepoVariant({ title, sourceData }: { title: string; sourceData: GithubSourceData }) {
  const stats = [
    { key: 'stars', n: sourceData.stars, label: 'stars' },
    { key: 'forks', n: sourceData.forks, label: 'forks' },
    { key: 'issues', n: sourceData.issues, label: 'issues' },
  ];
  const langPct = sourceData.languagePct ?? 0;

  return (
    <div style={{ padding: '13px 14px 2px' }}>
      <div
        style={{
          fontSize: '0.84rem',
          fontWeight: 500,
          color: 'var(--ink)',
          overflowWrap: 'break-word',
        }}
      >
        {title}
      </div>
      {sourceData.description && (
        <div style={{ fontSize: '0.76rem', color: 'var(--mut)', marginTop: 3, lineHeight: 1.5 }}>
          {sourceData.description}
        </div>
      )}
      <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
        {stats.map((s) => (
          <div key={s.key}>
            <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--ink)' }}>{s.n}</div>
            <div style={{ fontSize: '0.64rem', color: 'var(--ghost)', marginTop: 1 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
      {sourceData.language && (
        <>
          <div
            style={{
              display: 'flex',
              height: 3,
              borderRadius: 2,
              overflow: 'hidden',
              marginTop: 12,
            }}
          >
            <span style={{ width: `${langPct}%`, background: 'var(--mark)' }} />
            <span style={{ flex: 1, background: 'var(--line)' }} />
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--ghost)', marginTop: 5 }}>
            {sourceData.language}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The `pvIsVideo` (YouTube) variant (`Silo-v3.html:209-216`): a thumbnail
 * image at the top, then title + `{channel}` line. v3 also shows a
 * `{duration}` — dropped, the YouTube enricher never captures it (plan 012:
 * the only source is a paid/quota-gated API key, out of scope).
 *
 * The thumbnail is rendered via `/api/preview-image?linkId=` (never the raw
 * `sourceData.thumbnailUrl` — that would be a third-party fetch straight
 * from the browser, breaking the "no third-party calls per row" privacy
 * rule). `onError` swaps to a graceful placeholder matching v3's dashed
 * "video thumbnail" empty state, for when the proxy has nothing to serve —
 * which is CURRENTLY ALWAYS for YouTube links: the proxy serves the link's
 * stored `imageUrl` (`packages/api/src/routes/preview-image.ts`), but the
 * YouTube enricher (`packages/worker/src/enrich-source/youtube.ts`) only
 * populates `sourceData.thumbnailUrl`, never the link's `imageUrl` column —
 * a backend gap for a follow-up (worker should also set `imageUrl` for a
 * detected YouTube video, or the proxy should fall back to
 * `sourceData.thumbnailUrl` when `imageUrl` is null). Until then this
 * variant always shows the placeholder for real YouTube links; the fixture
 * test below (a fake linkId with a 404 in jsdom) documents the SAME
 * graceful path, not the eventual populated one.
 */
function VideoVariant({
  title,
  linkId,
  sourceData,
}: {
  title: string;
  linkId: string;
  sourceData: YoutubeSourceData;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  // Reset the failed-image flag whenever the previewed link changes (review
  // fix, ce-correctness-reviewer). `HoverPreviewContext` renders ONE shared
  // `HoverPreview`/`VideoVariant` instance (no `key`), and `scheduleShow`
  // transitions `preview` straight from link A to link B without a `null` in
  // between — so this component instance is REUSED across links. Without this
  // reset, a `true` `imageFailed` from link A's 404'd thumbnail would leak
  // onto link B and permanently suppress B's (possibly perfectly loadable)
  // thumbnail, showing the placeholder instead. Keyed on `linkId` so it only
  // fires on an actual link change, not on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `linkId` is the intended reset trigger; `setImageFailed` is a stable useState setter.
  useEffect(() => {
    setImageFailed(false);
  }, [linkId]);

  return (
    <>
      {imageFailed ? (
        <div
          style={{
            height: 130,
            background:
              'repeating-linear-gradient(45deg, var(--bg2) 0 10px, var(--line) 10px 20px)',
            display: 'grid',
            placeItems: 'center',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <span
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.66rem',
              color: 'var(--fnt)',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 5,
              padding: '2px 8px',
            }}
          >
            video thumbnail
          </span>
        </div>
      ) : (
        // Decorative supplement to the title text below — alt="" is
        // intentional (satisfies useAltText); the title conveys the content.
        <img
          src={previewImageUrl(linkId)}
          alt=""
          onError={() => setImageFailed(true)}
          style={{
            display: 'block',
            width: '100%',
            height: 130,
            objectFit: 'cover',
            borderBottom: '1px solid var(--line)',
          }}
        />
      )}
      <div style={{ padding: '12px 14px 2px' }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>
          {title}
        </div>
        <div style={{ fontSize: '0.76rem', color: 'var(--fnt)', marginTop: 4 }}>
          {sourceData.channel}
        </div>
      </div>
    </>
  );
}

/** The `pvIsGeneric` variant (`Silo-v3.html:252-261`) — unchanged from before this un-parking. */
function GenericVariant({
  title,
  tagLine,
  hasTags,
  notes,
  hasNote,
}: {
  title: string;
  tagLine: string;
  hasTags: boolean;
  notes: string | null;
  hasNote: boolean;
}) {
  return (
    <div style={{ padding: '13px 14px 2px' }}>
      <div style={{ fontSize: '0.84rem', fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>
        {title}
      </div>
      {hasTags && (
        <div style={{ fontSize: '0.76rem', color: 'var(--ghost)', marginTop: 6 }}>{tagLine}</div>
      )}
      {hasNote && (
        <div
          style={{ fontSize: '0.78rem', color: 'var(--mut)', fontStyle: 'italic', marginTop: 6 }}
        >
          "{notes}"
        </div>
      )}
    </div>
  );
}

/**
 * The `pvOpen` fixed popover (plan 011, V3-8 — `Silo-v3.html:207-277`; the
 * rich variants un-parked plan 012 phase 2). Dispatches on
 * `link.sourceData.kind`: `hacker_news` → `HnVariant`, `github` →
 * `RepoVariant`, `youtube` → `VideoVariant`, everything else (`'link'`, the
 * universal floor covering both a plain link AND a detected-but-not-yet-
 * enriched rich source — see `@silo/core`'s `resolveSource` doc comment) →
 * `GenericVariant`. Twitter has no variant (plan 012 scope: no free API,
 * deferred) — a `twitter` `sourceData.kind` falls through to generic rather
 * than crashing, since the union's floor case makes that safe.
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
      {link.sourceData.kind === 'hacker_news' ? (
        <HnVariant title={title} sourceData={link.sourceData} />
      ) : link.sourceData.kind === 'github' ? (
        <RepoVariant title={title} sourceData={link.sourceData} />
      ) : link.sourceData.kind === 'youtube' ? (
        <VideoVariant title={title} linkId={link.id} sourceData={link.sourceData} />
      ) : (
        <GenericVariant
          title={title}
          tagLine={tagLine}
          hasTags={hasTags}
          notes={link.notes}
          hasNote={hasNote}
        />
      )}
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
