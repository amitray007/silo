import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useInRouterContext } from 'react-router';
import { type LinkCard, linkCardOptions } from '../../../api/hooks';
import { relativeTimeFromNow } from '../../../lib/relativeTime';
import { deriveDomain, siteName } from '../../../lib/url';
import { Chip } from '../../Chip';

const STACK_MAX = 4;
const savedLink = /\]\(\/\?link=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

/** The saved links an answer cites, once each, in the order it first cites them. */
export function citedIds(answer: string): string[] {
  return [...new Set([...answer.matchAll(savedLink)].map(([, id = '']) => id.toLowerCase()))];
}

type Source = { id: string; card: LinkCard };

/** One favicon per site (en. and fr.wikipedia.org are one), so links to one site do not smear. */
const stackDomains = (sources: Source[]) =>
  [
    ...new Map(
      sources.map(({ card }) => [siteName(deriveDomain(card.url)), deriveDomain(card.url)]),
    ).values(),
  ].slice(0, STACK_MAX);

/**
 * Under a finished answer: the cited links as overlapping favicons and "N sources", opening a
 * grid of them. A made-up id never resolves, so it is neither shown nor counted.
 */
export function SourcesRow({
  answer,
  resolved,
}: {
  answer: string;
  /** Made-up ids the answer cited, mapped to the real links they matched by title. */
  resolved: Record<string, string>;
}) {
  const inRouter = useInRouterContext();
  const ids = [...new Set(citedIds(answer).map((id) => resolved[id] ?? id))];
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
          {stackDomains(sources).map((domain) => (
            <Chip key={domain} domain={domain} size={16} />
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
