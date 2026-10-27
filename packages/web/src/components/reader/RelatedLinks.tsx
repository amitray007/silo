import { useEffect, useId, useMemo, useState } from 'react';
import { useCaptureLink, useLinkTitles, useSavedLinks } from '../../api/hooks';
import type { LinkDetailJson, LinkJson } from '../../api/types';
import { extractRelatedLinks, type RelatedLink } from '../../lib/relatedLinks';
import { useRelatedLinksOpen } from '../../lib/useRelatedLinksOpen';
import { Chip } from '../Chip';
import { ReaderIcon } from './ReaderIcon';

function sameWords(a: string, b: string): boolean {
  const words = (text: string) => text.toLowerCase().replace(/\W+/g, ' ').trim();
  return words(a) === words(b);
}

function RelatedLinkRow({
  link,
  pageTitle,
  saved,
  checking,
}: {
  link: RelatedLink;
  pageTitle: string | undefined;
  saved: boolean;
  checking: boolean;
}) {
  const title = pageTitle ?? link.title;
  // The author's link text stays visible when the page calls itself something else.
  const linkText = pageTitle && !sameWords(pageTitle, link.title) ? link.title : undefined;
  const capture = useCaptureLink();
  const [showConfirmation, setShowConfirmation] = useState(true);
  useEffect(() => {
    if (!capture.isSuccess) return;
    const timer = window.setTimeout(() => setShowConfirmation(false), 1500);
    return () => window.clearTimeout(timer);
  }, [capture.isSuccess]);
  const confirmed = capture.isSuccess;
  const hideBookmark = (saved || confirmed) && !(confirmed && showConfirmation);
  return (
    <li className="silo-related-row">
      <a
        className="silo-related-link"
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        <Chip domain={link.hostname} size={20} />
        <span className="silo-related-text">
          <span className="silo-related-title" title={title}>
            {title}
          </span>
          {linkText && <span className="silo-related-linktext">{linkText}</span>}
        </span>
      </a>
      <div className="silo-related-action">
        {capture.isError && <span role="alert">Couldn't save</span>}
        {!hideBookmark && (
          <button
            type="button"
            className="silo-related-bookmark"
            aria-label={confirmed ? 'Saved' : 'Save link'}
            aria-pressed={confirmed}
            aria-busy={capture.isPending}
            disabled={checking || capture.isPending || confirmed}
            title={capture.isError ? 'Retry saving link' : undefined}
            onClick={(event) => {
              event.stopPropagation();
              capture.mutate({ url: link.url });
            }}
          >
            <ReaderIcon name={confirmed ? 'bookmarkFilled' : 'bookmark'} />
            {capture.isError && <span>Retry</span>}
          </button>
        )}
      </div>
    </li>
  );
}

function RelatedLinksList({ links }: { links: RelatedLink[] }) {
  const [open, setOpen] = useRelatedLinksOpen();
  const id = useId();
  const urls = useMemo(() => links.map((link) => link.url), [links]);
  const lookup = useSavedLinks(urls);
  const titles = useLinkTitles(urls, open).data?.titles;
  const saved = new Set(lookup.data?.saved);
  return (
    <section className="silo-related" aria-label="Related links">
      <button
        type="button"
        className="silo-related-header"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Related links
        <svg
          className="silo-related-caret"
          data-open={open}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path d="M1.5 3h7L5 7.5z" fill="currentColor" />
        </svg>
        <span className="silo-related-line" aria-hidden="true" />
      </button>
      <ul id={id} className="silo-related-list" hidden={!open}>
        {links.map((link) => (
          <RelatedLinkRow
            key={link.url}
            link={link}
            pageTitle={titles?.[link.url]}
            saved={saved.has(link.url)}
            checking={lookup.isPending}
          />
        ))}
      </ul>
    </section>
  );
}

export function RelatedLinks({
  link,
  trashed = false,
}: {
  link: LinkJson | LinkDetailJson;
  trashed?: boolean;
}) {
  const html = 'contentHtml' in link ? link.contentHtml : null;
  const inTrash = trashed || ('deletedAt' in link && typeof link.deletedAt === 'string');
  const links = useMemo(
    () => (html && !inTrash ? extractRelatedLinks(html, link.url) : []),
    [html, inTrash, link.url],
  );
  return links.length > 0 ? <RelatedLinksList key={link.id} links={links} /> : null;
}
