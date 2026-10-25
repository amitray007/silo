import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { LinkJson } from '../../api/types';
import { purgeCountdownDays } from '../../lib/buckets';
import { relativeTimeFromNow } from '../../lib/relativeTime';
import { deriveDomain, deriveTitleFromUrl } from '../../lib/url';
import { Chip } from '../Chip';
import { embedFor } from './embedFor';
import { Original } from './Original';
import { OriginalControls } from './OriginalControls';
import { ReaderContent } from './ReaderContent';
import { ReaderIcon } from './ReaderIcon';
import { ReaderSkeleton } from './ReaderLoading';
import { ReaderPlayer } from './ReaderPlayer';
import { type OriginalState, useOriginal } from './useOriginal';
import type { useReaderActions } from './useReaderActions';
import { seekChapter, YouTubeStats } from './YouTubeDetails';

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
      {!trashed && (
        <IconButton name="edit" label="Edit" onClick={() => actions.edit()} disabled={disabled} />
      )}
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
  original,
}: {
  actions: Actions;
  disabled: boolean;
  trashed: boolean;
  original: OriginalState | undefined;
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
          {original && <OriginalControls state={original} />}
          <ReaderActions actions={actions} disabled={disabled} trashed={trashed} />
        </div>
      )}
    </div>
  );
}

function ArticleBody({ link, loading }: { link: LinkJson; loading: boolean }) {
  return loading && !('contentHtml' in link) ? <ReaderSkeleton /> : <ReaderContent link={link} />;
}

function ReaderArticle({
  link,
  actions,
  trashed,
  purgeWindowDays,
  loading,
}: {
  link: LinkJson;
  actions: Actions;
  trashed: boolean;
  purgeWindowDays: number;
  loading: boolean;
}) {
  const domain = deriveDomain(link.url);
  const embed = embedFor(link.url, link.sourceData);
  const video = embed && ['youtube', 'vimeo', 'loom'].includes(embed.provider) ? embed : undefined;
  const deletedAt = 'deletedAt' in link && typeof link.deletedAt === 'string' ? link.deletedAt : '';
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: delegated native anchor clicks also fire on Enter.
    <article className="silo-reader" onClick={(event) => seekChapter(event, video)}>
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
      {video && <ReaderPlayer embed={video} />}
      <h2>{link.title ?? deriveTitleFromUrl(link.url)}</h2>
      <YouTubeStats source={link.sourceData} />
      <div className="silo-reader-source">
        <Chip domain={domain} size={20} />
        <span>{link.siteName || domain}</span>
        <span className="silo-reader-dot">•</span>
        <span>{relativeTimeFromNow(link.createdAt)}</span>
        {link.addedBy === 'agent' && <span className="silo-reader-agent">◆ Added by Claude</span>}
        {link.captureStatus === 'enriching' && <span className="silo-capturing">◌ Capturing</span>}
      </div>
      {trashed ? (
        link.notes && (
          <div className="silo-reader-notecard">
            <span>¶ Note</span>
            <span>{link.notes}</span>
          </div>
        )
      ) : link.notes ? (
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
        {!trashed && (
          <button
            type="button"
            className="silo-reader-tag"
            aria-label="Edit tags"
            onClick={() => actions.edit('tags')}
          >
            <ReaderIcon name="plus" />
          </button>
        )}
      </div>
      <ArticleBody link={link} loading={loading} />
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
  canGoNext,
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
  canGoNext: boolean;
  actions: Actions;
  trashed: boolean;
  purgeWindowDays: number;
  title: string;
  loading: boolean;
}) {
  const original = useOriginal(link, tab === 'original');
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (selectedId && !wasOpen.current && matchMedia('(max-width: 719px)').matches)
      panelRef.current?.focus();
    wasOpen.current = Boolean(selectedId);
  }, [selectedId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll when the content changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [selectedId, tab]);

  let content: ReactNode = (
    <div className="silo-empty-reader">
      <div>
        <ReaderIcon name="sidebar" />
        <p>Select a link to read</p>
        <span>Use ↑ ↓ or j k to move through your {trashed ? 'trash' : 'library'}.</span>
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
        <Original key={link.id} link={link} state={original} />
      ) : (
        <ReaderArticle
          link={link}
          actions={actions}
          trashed={trashed}
          purgeWindowDays={purgeWindowDays}
          loading={loading}
        />
      );
  return (
    <section className="silo-readerpane" aria-label="Link reader" ref={panelRef} tabIndex={-1}>
      <div className="silo-reader-head">
        <div className="silo-reader-desktop">
          <div className="silo-reader-tools">
            <IconButton name="close" label="Close reader" onClick={close} disabled={!selectedId} />
            <IconButton name="up" label="Previous" onClick={() => step(-1)} disabled={index <= 0} />
            <IconButton name="down" label="Next" onClick={() => step(1)} disabled={!canGoNext} />
          </div>
        </div>
        <button type="button" className="silo-reader-back" onClick={close}>
          <ReaderIcon name="back" />
          {title}
        </button>
        <div className="silo-reader-viewtools">
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
          {tab === 'original' && link && (
            <div className="silo-reader-desktop">
              <OriginalControls state={original} />
            </div>
          )}
        </div>
        <div className="silo-reader-desktop">
          <ReaderActions actions={actions} disabled={!link} trashed={trashed} />
        </div>
        <ReaderMore
          key={selectedId}
          actions={actions}
          disabled={!link}
          trashed={trashed}
          original={tab === 'original' ? original : undefined}
        />
      </div>
      {actions.feedback && (
        <div className="silo-toast" role="status">
          {actions.feedback}
        </div>
      )}
      <div
        className="silo-reader-scroll"
        data-original={tab === 'original'}
        ref={scrollRef}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
      >
        {content}
      </div>
      <div className="silo-reader-rbar" role="toolbar" aria-label="Reader actions">
        <IconButton name="up" label="Previous" onClick={() => step(-1)} disabled={index <= 0} />
        <IconButton name="down" label="Next" onClick={() => step(1)} disabled={!canGoNext} />
        <IconButton name="copy" label="Copy link" onClick={actions.copy} disabled={!link} />
        {!trashed && (
          <IconButton name="edit" label="Edit" onClick={() => actions.edit()} disabled={!link} />
        )}
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
