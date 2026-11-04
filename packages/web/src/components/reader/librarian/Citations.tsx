import { createContext, isValidElement, useContext } from 'react';
import { useInRouterContext } from 'react-router';
import { ApiError } from '../../../api/client';
import { useCitationMatch, useLinkCard } from '../../../api/hooks';
import { deriveDomain } from '../../../lib/url';
import { CitationPill } from './CitationPill';
import type { CitationItem } from './citationItems';

const itemCitation = /^\/\?link=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const CitationItems = createContext<CitationItem[]>([]);

function citationText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(citationText).join('');
  if (isValidElement<{ children?: React.ReactNode }>(node))
    return citationText(node.props.children);
  return '';
}

const isMissing = (error: unknown) => error instanceof ApiError && error.status === 404;

function SavedCitation({ id, children }: { id: string; children?: React.ReactNode }) {
  const items = useContext(CitationItems);
  // Only a confirmed 404 means a made-up id; any other failure keeps the cited link.
  const missing = isMissing(useLinkCard(id).error);
  const { data: matched } = useCitationMatch(citationText(children), items, missing);
  if (!missing) return <SavedPill id={id}>{children}</SavedPill>;
  return matched ? <SavedPill id={matched}>{children}</SavedPill> : children;
}

/** A saved-item pill: the globe and the link text until its URL arrives. */
function SavedPill({ id, children }: { id: string; children?: React.ReactNode }) {
  const { data: card, error } = useLinkCard(id);
  if (!useInRouterContext() || isMissing(error)) return children;
  return (
    <CitationPill
      target={{ to: `/?link=${id}` }}
      domain={card ? deriveDomain(card.url) : null}
      title={citationText(children)}
      card={card}
    />
  );
}

/** The markdown `a` renderer: saved items open in Silo, other web links in a new tab. */
export function Citation({
  href,
  children,
}: {
  href?: string | undefined;
  children?: React.ReactNode;
}) {
  const cited = href ? itemCitation.exec(href)?.[1] : undefined;
  if (cited) return <SavedCitation id={cited}>{children}</SavedCitation>;
  if (href && !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return (
    <CitationPill
      target={{ href: href ?? '' }}
      domain={href ? deriveDomain(href) : null}
      title={citationText(children)}
    />
  );
}
