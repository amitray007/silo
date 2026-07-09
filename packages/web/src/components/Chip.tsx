import { useState } from 'react';

/**
 * True once the favicon `<img>` has actually decoded (not just started
 * loading). Only then do we drop the letter-fallback chrome (the `--bg2`
 * backing + hairline border), so a favicon that eventually fails still lands
 * back on a bordered letter tile rather than a naked glyph.
 */
type FaviconState = 'pending' | 'loaded' | 'failed';

/**
 * Deterministic letter-chip derivation: strips a leading `www.`, takes the
 * hostname's first dot-segment, keeps only alphanumerics, and uppercases the
 * first character. Mirrors the prototype's `Component.chip()` derivation
 * (docs/design/app/Silo-v2.html), surfacing a single letter per the W3 spec.
 * This is the chip's FALLBACK content — shown while the favicon overlay is
 * loading and whenever it fails (see `Chip` below for the privacy story).
 */
export function chipLetter(domain: string | null | undefined): string {
  const segment = (
    String(domain ?? '')
      .replace(/^www\./i, '')
      .split('.')[0] ?? ''
  ).replace(/[^a-z0-9]/gi, '');
  return segment ? segment.charAt(0).toUpperCase() : '·';
}

/**
 * The 18px domain chip (`Silo-v3.html`'s `favBg` chip): the letter fill stays
 * the base layer, with a real favicon overlaid absolutely `inset:0` on top
 * once it loads. Privacy is preserved per plan 011's V3-2 decision — the
 * favicon is fetched from silo's OWN `/api/favicon?domain=` proxy
 * (`packages/api/src/routes/favicon.ts`), never from a third-party host
 * directly; the browser only ever talks to silo's own origin. An `<img>`
 * (not a CSS `background-image`, which can't signal failure) is used so
 * `onError`/`onLoad` can track it, gracefully revealing the letter underneath
 * on failure — no broken-image icon, no third-party call, no flash of the
 * fallback once a favicon is cached.
 *
 * Vibrancy (direct user feedback — "make the icons pop like shiori"): the
 * `--bg2` backing + hairline border are the LETTER-FALLBACK chrome ONLY. Once
 * a real favicon decodes (`state === 'loaded'`) they're dropped, so the
 * favicon's own colour fills the chip edge-to-edge and reads as a vivid app
 * mark rather than a colour swatch trapped in a grey box. A favicon that
 * never loads (or fails) keeps the bordered letter tile — the resting look
 * for sites without an icon is unchanged.
 */
export function Chip({ domain, size = 18 }: { domain: string | null | undefined; size?: number }) {
  const [state, setState] = useState<FaviconState>('pending');
  const showLetterChrome = state !== 'loaded';

  return (
    <span
      style={{
        flex: 'none',
        width: size,
        height: size,
        borderRadius: 4,
        // Backing + border only while the letter is the visible content —
        // gone the moment a favicon decodes so its colour isn't muted.
        background: showLetterChrome ? 'var(--bg2)' : 'transparent',
        border: showLetterChrome ? '1px solid var(--line)' : 'none',
        color: 'var(--mut)',
        fontSize: '0.5rem',
        fontWeight: 500,
        display: 'grid',
        placeItems: 'center',
        letterSpacing: '0.01em',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {showLetterChrome && <span aria-hidden="true">{chipLetter(domain)}</span>}
      {domain && state !== 'failed' && (
        // Decorative: alt="" + aria-hidden — the letter behind it already
        // conveys the domain to assistive tech (satisfies useAltText).
        <img
          src={`/api/favicon?domain=${encodeURIComponent(domain)}`}
          alt=""
          aria-hidden="true"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}
    </span>
  );
}
