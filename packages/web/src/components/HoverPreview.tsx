import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../api/hooks';
import type { LinkJson, SettingsMap, SourceData } from '../api/types';
import { previewImageUrl } from '../lib/previewImage';
import { relativeTimeFromNow } from '../lib/relativeTime';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';

/** Where the popover is pinned — `useHoverPreview` computes this from the hovered row's bounding rect, already clamped to the viewport (v3's `pvTop`/`pvLeft`). */
export type HoverPreviewPosition = { top: number; left: number };

type HackerNewsSourceData = Extract<SourceData, { kind: 'hacker_news' }>;
type GithubSourceData = Extract<SourceData, { kind: 'github' }>;
type YoutubeSourceData = Extract<SourceData, { kind: 'youtube' }>;
type TwitterSourceData = Extract<SourceData, { kind: 'twitter' }>;

/**
 * The body padding + title line every variant (`HnVariant`/`RepoVariant`/
 * `VideoVariant`/`GenericVariant`) opens with — same `var(--s3) var(--s3-5)
 * var(--s-0-5)` padding, same 0.84rem/500/`--ink` title treatment, every
 * time. `children` is the variant-specific content below the title (stats
 * row, description, tags/note, etc.) — the one part that's genuinely
 * different per source kind. Pulled out so the four variants don't each
 * repeat this exact wrapper (jscpd guards production src at 1.5%).
 */
function VariantBody({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ padding: 'var(--s3) var(--s3-5) var(--s-0-5)' }}>
      <div
        style={{
          fontSize: 'var(--text-base)',
          fontWeight: 500,
          color: 'var(--ink)',
          lineHeight: 1.4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * The 130px cover image atop the `RepoVariant`/`VideoVariant` cards, served
 * through silo's own `/api/preview-image` proxy (never a third-party fetch
 * from the browser — see each variant's doc comment for why). Both variants
 * reset `imageFailed` on `linkId` change (the shared `HoverPreview` instance
 * is reused across links, so a stale failure from link A must not suppress
 * link B's image) and swap to a caller-supplied fallback on `onError` —
 * `RepoVariant` simply omits the image, `VideoVariant` shows a dashed
 * placeholder, so the fallback stays a prop rather than being baked in here.
 */
function PreviewCoverImage({ linkId, onError }: { linkId: string; onError: () => void }) {
  return (
    // Decorative supplement to the title/stats below — alt="" is
    // intentional (the title conveys the content).
    <img
      src={previewImageUrl(linkId)}
      alt=""
      onError={onError}
      style={{
        display: 'block',
        width: '100%',
        height: 130,
        objectFit: 'cover',
        borderBottom: '1px solid var(--line)',
      }}
    />
  );
}

/**
 * The `pvIsHn` variant (`Silo-v3.html:263-271`): title, then a line with
 * `▲ {points} points` in `--markt` (the amber-adjacent data-viz accent v3
 * uses for this exact stat — not button/chrome fill, so it's within the
 * "amber only as brand dot + status marks" rule) and `{comments} comments`
 * in `--fnt`.
 */
function HnVariant({ title, sourceData }: { title: string; sourceData: HackerNewsSourceData }) {
  return (
    <VariantBody title={title}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--s2-5)',
          marginTop: 'var(--s1-5)',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--markt)' }}>
          ▲ {sourceData.points} points
        </span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fnt)' }}>
          {sourceData.comments} comments
        </span>
      </div>
    </VariantBody>
  );
}

/**
 * The Twitter/X variant — no v3 mock to match (X was a static "Soon" card in
 * the captured prototype); shaped to sit alongside `HnVariant`/`RepoVariant`
 * exactly: same `VariantBody` padding/title treatment, `--text-sm` meta rows.
 * Shows the author line (`authorName` in `--ink`, `@authorHandle` in `--fnt`),
 * the tweet text (2-3 line clamp, same pattern as `RepoVariant`'s
 * description), then an engagement line with tasteful glyphs matching
 * `HnVariant`'s `▲` convention.
 *
 * `sourceData.text` is rendered as plain JSX text (`{sourceData.text}`), NOT
 * `dangerouslySetInnerHTML` — React escapes it automatically, and
 * `source-data.ts`'s doc comment flags tweet text as UNTRUSTED (captured by
 * the `silo ingest x` CLI from the page itself, not sanitized upstream), so
 * this is the only safe way to render it.
 *
 * Deliberately renders NO images (`authorAvatarUrl`/`mediaUrls`) — both are
 * raw `twimg.com` URLs, and rendering them as `<img src>` from the browser
 * would be a third-party network call per row, violating the "no third-party
 * calls per row" privacy rule (`CLAUDE.md`). Unlike `RepoVariant`/
 * `VideoVariant`, there's no silo-proxied equivalent for tweet media, so v1
 * simply omits it — text + counts only.
 */
function TwitterVariant({ title, sourceData }: { title: string; sourceData: TwitterSourceData }) {
  return (
    <VariantBody title={title}>
      <div style={{ marginTop: 'var(--s1-5)' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)' }}>
          {sourceData.authorName}
        </span>{' '}
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fnt)' }}>
          @{sourceData.authorHandle}
        </span>
      </div>
      <div
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--mut)',
          marginTop: 3,
          lineHeight: 'var(--lh-snug)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {sourceData.text}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--s2-5)',
          marginTop: 'var(--s3)',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fnt)' }}>
          ♥ {sourceData.likes}
        </span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fnt)' }}>
          ↻ {sourceData.reposts}
        </span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fnt)' }}>
          💬 {sourceData.replies}
        </span>
      </div>
    </VariantBody>
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
function RepoVariant({
  title,
  linkId,
  sourceData,
}: {
  title: string;
  linkId: string;
  sourceData: GithubSourceData;
}) {
  const stats = [
    { key: 'stars', n: sourceData.stars, label: 'stars' },
    { key: 'forks', n: sourceData.forks, label: 'forks' },
    { key: 'issues', n: sourceData.issues, label: 'issues' },
  ];
  const langPct = sourceData.languagePct ?? 0;

  // The repo's OG social-preview image (GitHub's opengraph.githubassets.com
  // card), captured into the link's `imageUrl` by the extractor and served
  // through silo's own /api/preview-image proxy (never a third-party fetch
  // from the browser). Same imageFailed + reset-on-linkId pattern as
  // VideoVariant — the shared HoverPreview instance is reused across links,
  // so a 404 from link A must not suppress link B's image. When there's no
  // image (private repo, proxy 404), the card simply omits it and shows the
  // stats-only layout as before — no placeholder needed here (unlike video,
  // a repo card reads fine without the banner).
  const [imageFailed, setImageFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `linkId` is the intended reset trigger; `setImageFailed` is a stable useState setter.
  useEffect(() => {
    setImageFailed(false);
  }, [linkId]);

  return (
    <>
      {!imageFailed && <PreviewCoverImage linkId={linkId} onError={() => setImageFailed(true)} />}
      <div style={{ padding: 'var(--s3) var(--s3-5) var(--s-0-5)' }}>
        <div
          style={{
            fontSize: 'var(--text-base)',
            fontWeight: 500,
            color: 'var(--ink)',
            overflowWrap: 'break-word',
            lineHeight: 1.4,
          }}
        >
          {title}
        </div>
        {sourceData.description && (
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--mut)',
              marginTop: 3,
              lineHeight: 'var(--lh-snug)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {sourceData.description}
          </div>
        )}
        {/* K3 (oat-conformance audit): gap 18 is LEFT un-tokenized — it sits
          between --s4/16px and --s5/20px with no clean step, and this is the
          stats row's own deliberate breathing room. marginTop 12 → var(--s3)
          exact (both places below). marginTop 1 is left un-tokenized (a
          sub-scale optical nudge, no --s* value that small exists). */}
        <div style={{ display: 'flex', gap: 18, marginTop: 'var(--s3)' }}>
          {stats.map((s) => (
            <div key={s.key}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)' }}>
                {s.n}
              </div>
              <div style={{ fontSize: '0.64rem', color: 'var(--fnt)', marginTop: 1 }}>
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
                marginTop: 'var(--s3)',
              }}
            >
              <span style={{ width: `${langPct}%`, background: 'var(--mark)' }} />
              <span style={{ flex: 1, background: 'var(--line)' }} />
            </div>
            <div
              style={{ fontSize: 'var(--text-xs)', color: 'var(--fnt)', marginTop: 'var(--s1-5)' }}
            >
              {sourceData.language}
            </div>
          </>
        )}
      </div>
    </>
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
              padding: 'var(--s-0-5) var(--s2)',
            }}
          >
            Video thumbnail
          </span>
        </div>
      ) : (
        <PreviewCoverImage linkId={linkId} onError={() => setImageFailed(true)} />
      )}
      <VariantBody title={title}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fnt)', marginTop: 'var(--s1)' }}>
          {sourceData.channel}
        </div>
      </VariantBody>
    </>
  );
}

/** The `pvIsGeneric` variant (`Silo-v3.html:252-261`) — unchanged from before this un-parking. */
// The note is deliberately NOT shown here — the row already renders it (the
// quoted line under the title, `LinkRow.tsx`), and the hover card sits right
// beside the row, so repeating the note was pure duplication (both visible in
// one eyeful). The hover shows tags; the note lives on the row.
function GenericVariant({
  title,
  tagLine,
  hasTags,
}: {
  title: string;
  tagLine: string;
  hasTags: boolean;
}) {
  return (
    <VariantBody title={title}>
      {hasTags && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fnt)', marginTop: 'var(--s1-5)' }}>
          {tagLine}
        </div>
      )}
    </VariantBody>
  );
}

/**
 * Whether a source's rich hover variant should render: its plugin must be
 * `enabled` AND its `hover` feature on. Both default to `true` while settings
 * are loading (`plugins` undefined), matching the app's optimism so there's no
 * flash of a missing preview. A `source` with no plugin entry (`link`) never
 * reaches here — see `SourceVariant`.
 */
function hoverEnabledFor(
  plugins: SettingsMap['plugins'] | undefined,
  source: 'hacker_news' | 'github' | 'youtube' | 'twitter',
): boolean {
  const p = plugins?.[source];
  return (p?.enabled ?? true) && (p?.hover ?? true);
}

/**
 * Picks the hover variant for a link, applying the plan-026 per-source plugin
 * gate (`hoverEnabledFor`): a source's rich variant (HN/GitHub/YouTube/
 * Twitter) renders only when that source's plugin is enabled AND its `hover`
 * feature is on — otherwise it falls through to `GenericVariant` (tags only).
 * `link` has no plugin toggle and always uses `GenericVariant`. Extracted from
 * `HoverPreview` so the popover component's own body stays flat.
 */
function SourceVariant({
  link,
  title,
  tagLine,
  hasTags,
  plugins,
}: {
  link: LinkJson;
  title: string;
  tagLine: string;
  hasTags: boolean;
  plugins: SettingsMap['plugins'] | undefined;
}) {
  const data = link.sourceData;
  if (data.kind === 'hacker_news' && hoverEnabledFor(plugins, 'hacker_news')) {
    return <HnVariant title={title} sourceData={data} />;
  }
  if (data.kind === 'github' && hoverEnabledFor(plugins, 'github')) {
    return <RepoVariant title={title} linkId={link.id} sourceData={data} />;
  }
  if (data.kind === 'youtube' && hoverEnabledFor(plugins, 'youtube')) {
    return <VideoVariant title={title} linkId={link.id} sourceData={data} />;
  }
  if (data.kind === 'twitter' && hoverEnabledFor(plugins, 'twitter')) {
    return <TwitterVariant title={title} sourceData={data} />;
  }
  return <GenericVariant title={title} tagLine={tagLine} hasTags={hasTags} />;
}

/**
 * The `pvOpen` fixed popover (plan 011, V3-8 — `Silo-v3.html:207-277`; the
 * rich variants un-parked plan 012 phase 2, Twitter un-parked plan 026).
 * Dispatches on `link.sourceData.kind`: `hacker_news` → `HnVariant`, `github`
 * → `RepoVariant`, `youtube` → `VideoVariant`, `twitter` → `TwitterVariant`,
 * everything else (`'link'`, the universal floor covering both a plain link
 * AND a detected-but-not-yet-enriched rich source — see `@silo/core`'s
 * `resolveSource` doc comment) → `GenericVariant`.
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
  const meta = relativeTimeFromNow(link.createdAt);

  // Plan 026: a source's rich hover variant only renders when that source's
  // plugin is enabled AND its `hover` feature is on — otherwise fall through
  // to the plain GenericVariant (tags only). The card still appears; only the
  // source-specific detail is gated. Default to SHOWING while settings load
  // (`?? true`), matching the app's optimism, so there's no flash of a missing
  // preview. Twitter/link have no plugin toggle and always use GenericVariant.
  const { data: settings } = useSettings();

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-hover handoff only (v3's `pvKeep`/`pvHide`) — the only actual control inside (the `open ↗` anchor) is independently keyboard-operable; this wrapper just extends the hover region onto the card itself.
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
        // K6 (oat-conformance audit): sourced from the shared elevation ramp.
        boxShadow: 'var(--elev-2)',
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
      <SourceVariant
        link={link}
        title={title}
        tagLine={tagLine}
        hasTags={hasTags}
        plugins={settings?.plugins}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s2)',
          padding: 'var(--s2-5) var(--s3-5) var(--s2-5)',
          marginTop: 'var(--s2)',
          borderTop: '1px solid var(--line)',
          fontSize: 'var(--text-xs)',
          color: 'var(--fnt)',
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
            // Brightened from `--fnt` (direct user feedback): "Open ↗" is
            // this card's own primary affordance — the actual link-out
            // action, not meta text like the domain/time beside it.
            color: 'var(--mut)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Open ↗
        </a>
      </div>
    </div>,
    document.body,
  );
}
