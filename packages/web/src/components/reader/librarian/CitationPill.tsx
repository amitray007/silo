import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { LinkCard } from '../../../api/hooks';
import { relativeTimeFromNow } from '../../../lib/relativeTime';
import { siteName } from '../../../lib/url';
import { Chip } from '../../Chip';

const FAVICON_PX = 14;
const CARD_WIDTH = 280;
const GAP = 6;
const EDGE = 8;
/** Long enough to cross the gap between pill and card without the card closing. */
const CLOSE_DELAY_MS = 120;

type Place = { left: number; top?: number; bottom?: number };

/** Fixed coordinates for the card: above the pill when there is room, kept inside the window. */
function placeCard(pill: DOMRect): Place {
  const left = Math.max(EDGE, Math.min(pill.left, window.innerWidth - CARD_WIDTH - EDGE));
  return pill.top > 140
    ? { left, bottom: window.innerHeight - pill.top + GAP }
    : { left, top: pill.bottom + GAP };
}

export type PillTarget = { to: string } | { href: string };

const bareUrl = /^(https?:\/\/|www\.)/i;

/** The model's link text, unless it is empty, a bare URL or just the domain: then the site name. */
function pillLabel(title: string, domain: string | null): string {
  const text = title.trim();
  const site = domain ? siteName(domain) : '';
  if (text && !bareUrl.test(text) && text.toLowerCase() !== domain?.toLowerCase()) return text;
  return site || text;
}

/**
 * An inline citation: favicon and the link text. Hovering or focusing it opens a card with the
 * site, the saved date and the title; the card stays open while the pointer is over it, and
 * Escape or scrolling closes it. The card is never focusable, so it cannot trap focus. `card` is
 * the saved link's cached data; an external link shows its host and the link text instead.
 */
export function CitationPill({
  target,
  domain,
  title,
  card,
}: {
  target: PillTarget;
  domain: string | null;
  title: string;
  card?: LinkCard | undefined;
}) {
  const [place, setPlace] = useState<Place | null>(null);
  const closing = useRef<number>(0);
  const cardId = useId();
  const label = pillLabel(title, domain);
  const cancelClose = useCallback(() => window.clearTimeout(closing.current), []);
  const close = useCallback(() => {
    cancelClose();
    setPlace(null);
  }, [cancelClose]);
  const closeSoon = () => {
    cancelClose();
    closing.current = window.setTimeout(close, CLOSE_DELAY_MS);
  };
  const open = (pill: HTMLElement) => {
    cancelClose();
    setPlace(placeCard(pill.getBoundingClientRect()));
  };
  const isOpen = place !== null;
  // The card is fixed: scrolling would leave it behind its pill.
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [isOpen, close]);
  useEffect(() => cancelClose, [cancelClose]);
  const events = {
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => open(event.currentTarget),
    onMouseLeave: closeSoon,
    onFocus: (event: React.FocusEvent<HTMLElement>) => open(event.currentTarget),
    onBlur: close,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && place) {
        event.stopPropagation();
        close();
      }
    },
    'aria-label': domain && label !== title.trim() ? `${title} (${label})` : label,
    'aria-describedby': place ? cardId : undefined,
    className: 'silo-cite',
  };
  const content = (
    <>
      <Chip domain={domain} size={FAVICON_PX} />
      <span className="silo-cite-name">{label}</span>
    </>
  );
  return (
    <>
      {'to' in target ? (
        <Link to={target.to} {...events}>
          {content}
        </Link>
      ) : (
        <a href={target.href} target="_blank" rel="noopener noreferrer" {...events}>
          {content}
        </a>
      )}
      {place && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the card only keeps itself open under the pointer.
        <span
          id={cardId}
          role="tooltip"
          className="silo-cite-card"
          style={place}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
        >
          <span className="silo-cite-card-site">
            <Chip domain={domain} size={FAVICON_PX} />
            {domain}
            {card && (
              <time dateTime={card.createdAt}>Saved {relativeTimeFromNow(card.createdAt)}</time>
            )}
          </span>
          <b>{card?.title || title}</b>
        </span>
      )}
    </>
  );
}
