import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { LinkCard } from '../../../api/hooks';
import { relativeTimeFromNow } from '../../../lib/relativeTime';
import { siteName } from '../../../lib/url';
import { Chip } from '../../Chip';

const FAVICON_PX = 14;
const CARD_WIDTH = 280;
const GAP = 6;
const EDGE = 8;

type Place = { left: number; top?: number; bottom?: number };

/** Fixed coordinates for the card: above the pill when there is room, kept inside the window. */
function placeCard(pill: DOMRect): Place {
  const left = Math.max(EDGE, Math.min(pill.left, window.innerWidth - CARD_WIDTH - EDGE));
  return pill.top > 140
    ? { left, bottom: window.innerHeight - pill.top + GAP }
    : { left, top: pill.bottom + GAP };
}

export type PillTarget = { to: string } | { href: string };

/**
 * An inline citation: favicon and short site name. Hovering or focusing it opens a card with the
 * site, the saved date and the title; Escape closes it. The card is never focusable, so it
 * cannot trap focus. `card` is the saved link's cached data; an external link shows its host and
 * the link text instead.
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
  const cardId = useId();
  const host = domain ?? '';
  const site = host ? siteName(host) : title;
  const label = host && title ? `${title} (${site})` : site;
  const open = (pill: HTMLElement) => setPlace(placeCard(pill.getBoundingClientRect()));
  const events = {
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => open(event.currentTarget),
    onMouseLeave: () => setPlace(null),
    onFocus: (event: React.FocusEvent<HTMLElement>) => open(event.currentTarget),
    onBlur: () => setPlace(null),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && place) {
        event.stopPropagation();
        setPlace(null);
      }
    },
    'aria-label': label,
    'aria-describedby': place ? cardId : undefined,
    className: 'silo-cite',
  };
  const content = (
    <>
      <Chip domain={domain} size={FAVICON_PX} />
      <span className="silo-cite-name">{site}</span>
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
        <span id={cardId} role="tooltip" className="silo-cite-card" style={place}>
          <span className="silo-cite-card-site">
            <Chip domain={domain} size={FAVICON_PX} />
            {host}
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
