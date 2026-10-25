import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { LinkJson } from '../../api/types';
import { purgeCountdownDays } from '../../lib/buckets';
import { relativeTimeFromNow } from '../../lib/relativeTime';
import { deriveDomain, deriveTitleFromUrl } from '../../lib/url';
import { Chip } from '../Chip';
import { ReaderContent } from './ReaderContent';
import { ReaderIcon } from './ReaderIcon';
import { originalUrl, type useReaderActions } from './useReaderActions';

type Actions = ReturnType<typeof useReaderActions>;
type Tab = 'reader' | 'original';

function IconButton({
  name,
  label,
  onClick,
  disabled = false,
}: {
  name: Parameters<typeof ReaderIcon>[0]['name'];
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="silo-reader-iconbtn"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <ReaderIcon name={name} />
    </button>
  );
}

function ReaderActions({
  actions,
  disabled,
  trashed,
}: {
  actions: Actions;
  disabled: boolean;
  trashed: boolean;
}) {
  return (
    <div className="silo-reader-tools">
      <IconButton name="copy" label="Copy link" onClick={actions.copy} disabled={disabled} />
      <IconButton name="edit" label="Edit" onClick={() => actions.edit()} disabled={disabled} />
      <IconButton
        name="external"
        label="Open original"
        onClick={actions.open}
        disabled={disabled}
      />
      <IconButton
        name={trashed ? 'restore' : 'trash'}
        label={trashed ? 'Restore' : 'Move to trash'}
        onClick={trashed ? actions.restore : actions.trash}
        disabled={disabled || actions.busy}
      />
    </div>
  );
}

function ReaderMore({
  actions,
  disabled,
  trashed,
}: {
  actions: Actions;
  disabled: boolean;
  trashed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', pointer);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('mousedown', pointer);
      document.removeEventListener('keydown', keyboard, true);
    };
  }, [open]);
  return (
    <div className="silo-reader-more" ref={ref}>
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        ⋯
      </button>
      {open && (
        <div className="silo-reader-more-menu" data-reader-menu>
          <ReaderActions actions={actions} disabled={disabled} trashed={trashed} />
        </div>
      )}
    </div>
  );
}

function Original({ link }: { link: LinkJson }) {
  const url = originalUrl(link.url);
  return (
    <div className="silo-original">
      <div className="silo-original-bar">
        <span title={link.url}>{link.url}</span>
        {url && (
          <a className="silo-reader-btn" href={url} target="_blank" rel="noopener noreferrer">
            Open in new tab <ReaderIcon name="external" />
          </a>
        )}
      </div>
      <p className="silo-original-hint">
        Blank page? Some sites block embedding. Open it in a new tab.
      </p>
      {url && (
        <iframe
          title="Original page"
          className="silo-original-frame"
          src={url}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}
    </div>
  );
}

function ReaderArticle({
  link,
  actions,
  trashed,
  purgeWindowDays,
}: {
  link: LinkJson;
  actions: Actions;
  trashed: boolean;
  purgeWindowDays: number;
}) {
  const domain = deriveDomain(link.url);
  const deletedAt = 'deletedAt' in link && typeof link.deletedAt === 'string' ? link.deletedAt : '';
  return (
    <article className="silo-reader">
      {trashed && (
        <div className="silo-reader-trashnote">
          <ReaderIcon name="trash" />
          <span>In trash · Purges in {purgeCountdownDays(deletedAt, purgeWindowDays)} days</span>
          <div className="silo-reader-trashactions">
            <button
              type="button"
              className="silo-reader-btn"
              disabled={actions.busy}
              onClick={actions.restore}
            >
              Restore
            </button>
            <button
              type="button"
              className="silo-reader-btn silo-reader-danger"
              disabled={actions.busy}
              onClick={actions.remove}
            >
              Delete forever
            </button>
          </div>
        </div>
      )}
      <h2>{link.title ?? deriveTitleFromUrl(link.url)}</h2>
      <div className="silo-reader-source">
        <Chip domain={domain} size={20} />
        <span>{link.siteName || domain}</span>
        <span className="silo-reader-dot">•</span>
        <span>{relativeTimeFromNow(link.createdAt)}</span>
        {link.addedBy === 'agent' && <span className="silo-reader-agent">◆ Added by Claude</span>}
        {link.captureStatus === 'enriching' && <span className="silo-capturing">◌ Capturing</span>}
      </div>
      {link.notes ? (
        <button
          type="button"
          className="silo-reader-notecard"
          onClick={() => actions.edit('note')}
          title="Edit note"
        >
          <span>¶ Note</span>
          <span>{link.notes}</span>
        </button>
      ) : (
        <button type="button" className="silo-reader-addnote" onClick={() => actions.edit('note')}>
          <ReaderIcon name="plus" />
          Add a note
        </button>
      )}
      <div className="silo-reader-tags">
        {link.tags.map((tag) => (
          <Link className="silo-reader-tag" to={`/tags/${encodeURIComponent(tag)}`} key={tag}>
            <span>#</span>
            {tag}
          </Link>
        ))}
        <button
          type="button"
          className="silo-reader-tag"
          aria-label="Edit tags"
          onClick={() => actions.edit('tags')}
        >
          <ReaderIcon name="plus" />
        </button>
      </div>
      <ReaderContent link={link} />
    </article>
  );
}

export function ReaderPane({
  link,
  selectedId,
  tab,
  setTab,
  close,
  step,
  index,
  count,
  actions,
  trashed,
  purgeWindowDays,
  title,
  loading,
}: {
  link: LinkJson | undefined;
  selectedId: string | null;
  tab: Tab;
  setTab: (tab: Tab) => void;
  close: () => void;
  step: (delta: number) => void;
  index: number;
  count: number;
  actions: Actions;
  trashed: boolean;
  purgeWindowDays: number;
  title: string;
  loading: boolean;
}) {
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing Reader/Original also resets the scroll position.
  useEffect(() => {
    if (selectedId && matchMedia('(max-width: 719px)').matches) panelRef.current?.focus();
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [selectedId, tab]);

  let content: ReactNode = (
    <div className="silo-empty-reader">
      <div>
        <ReaderIcon name="sidebar" />
        <p>Select a link to read</p>
        <span>Use ↑ ↓ or j k to move through your library.</span>
      </div>
    </div>
  );
  if (loading)
    content = (
      <div className="silo-empty-reader" role="status">
        Loading link…
      </div>
    );
  if (link)
    content =
      tab === 'original' ? (
        <Original link={link} />
      ) : (
        <ReaderArticle
          link={link}
          actions={actions}
          trashed={trashed}
          purgeWindowDays={purgeWindowDays}
        />
      );
  return (
    <section className="silo-readerpane" aria-label="Link reader" ref={panelRef} tabIndex={-1}>
      <div className="silo-reader-head">
        <div className="silo-reader-desktop">
          <div className="silo-reader-tools">
            <IconButton name="close" label="Close reader" onClick={close} disabled={!selectedId} />
            <IconButton name="up" label="Previous" onClick={() => step(-1)} disabled={index <= 0} />
            <IconButton
              name="down"
              label="Next"
              onClick={() => step(1)}
              disabled={index < 0 || index >= count - 1}
            />
          </div>
        </div>
        <button type="button" className="silo-reader-back" onClick={close}>
          <ReaderIcon name="back" />
          {title}
        </button>
        <div className="silo-reader-segment" role="tablist" aria-label="Link view">
          {(['reader', 'original'] as const).map((value) => (
            <button
              type="button"
              role="tab"
              id={`${id}-${value}`}
              aria-controls={`${id}-panel`}
              key={value}
              aria-selected={tab === value}
              disabled={!link}
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  const next = value === 'reader' ? 'original' : 'reader';
                  setTab(next);
                  document.getElementById(`${id}-${next}`)?.focus();
                }
              }}
            >
              {value === 'reader' ? 'Reader' : 'Original'}
            </button>
          ))}
        </div>
        <div className="silo-reader-desktop">
          <ReaderActions actions={actions} disabled={!link} trashed={trashed} />
        </div>
        <ReaderMore key={selectedId} actions={actions} disabled={!link} trashed={trashed} />
      </div>
      {actions.feedback && (
        <div className="silo-reader-feedback" role="status">
          {actions.feedback}
        </div>
      )}
      <div
        className="silo-reader-scroll"
        ref={scrollRef}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
      >
        {content}
      </div>
      <div className="silo-reader-rbar" role="toolbar" aria-label="Reader actions">
        <IconButton name="up" label="Previous" onClick={() => step(-1)} disabled={index <= 0} />
        <IconButton
          name="down"
          label="Next"
          onClick={() => step(1)}
          disabled={index < 0 || index >= count - 1}
        />
        <IconButton name="copy" label="Copy link" onClick={actions.copy} disabled={!link} />
        <IconButton name="edit" label="Edit" onClick={() => actions.edit()} disabled={!link} />
        <IconButton
          name={trashed ? 'restore' : 'trash'}
          label={trashed ? 'Restore' : 'Move to trash'}
          onClick={trashed ? actions.restore : actions.trash}
          disabled={!link || actions.busy}
        />
      </div>
    </section>
  );
}
