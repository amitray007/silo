import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useInRouterContext } from 'react-router';
import { type LinkCard, linkCardOptions } from '../../../api/hooks';
import { relativeTimeFromNow } from '../../../lib/relativeTime';
import { deriveDomain } from '../../../lib/url';
import { Chip } from '../../Chip';

const STACK_MAX = 4;
const savedLink = /\]\(\/\?link=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

/** The saved links an answer cites, once each, in the order it first cites them. */
export function citedIds(answer: string): string[] {
  return [...new Set([...answer.matchAll(savedLink)].map(([, id = '']) => id.toLowerCase()))];
}

type Source = { id: string; card: LinkCard };

/**
 * Under a finished answer: the cited links as overlapping favicons and "N sources", opening a
 * grid of them. A made-up id never resolves, so it is neither shown nor counted.
 */
export function SourcesRow({ answer }: { answer: string }) {
  const inRouter = useInRouterContext();
  const ids = citedIds(answer);
  return inRouter && ids.length > 0 ? <SourcesFor ids={ids} /> : null;
}

function SourcesFor({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  const cards = useQueries({ queries: ids.map(linkCardOptions) });
  const sources = ids.flatMap((id, index): Source[] => {
    const card = cards[index]?.data;
    return card ? [{ id, card }] : [];
  });
  if (sources.length === 0) return null;
  return (
    <div className="silo-sources">
      <button
        type="button"
        className="silo-sources-btn"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        <span className="silo-sources-stack">
          {sources.slice(0, STACK_MAX).map(({ id, card }) => (
            <Chip key={id} domain={deriveDomain(card.url)} size={16} />
          ))}
        </span>
        {sources.length} {sources.length === 1 ? 'source' : 'sources'}
      </button>
      {open && (
        <ul className="silo-sources-grid">
          {sources.map(({ id, card }) => (
            <li key={id}>
              <Link to={`/?link=${id}`}>
                <Chip domain={deriveDomain(card.url)} size={18} />
                <b>{card.title || card.url}</b>
                <span>
                  {deriveDomain(card.url)} · {relativeTimeFromNow(card.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
