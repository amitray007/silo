import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type { LinkJson } from '../../api/types';
import { purgeCountdownDays } from '../../lib/buckets';
import { deriveTitleFromUrl } from '../../lib/url';
import { MenuPresence } from '../MenuPresence';
import { MenuAction, MenuSurface } from '../MenuSurface';
import { LinkMenuActions } from '../RowMenu';
import { embedFor } from './embedFor';
import { Original } from './Original';
import { ReaderContent } from './ReaderContent';
import { ReaderIcon } from './ReaderIcon';
import { ReaderSkeleton } from './ReaderLoading';
import { ReaderMeta } from './ReaderMeta';
import { ReaderPlayer } from './ReaderPlayer';
import { ReaderSegment } from './ReaderSegment';
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

function RefreshButton({ original }: { original: OriginalState | undefined }) {
  if (!original || original.mode === 'player') return null;
  return (
    <IconButton
      name="refresh"
      label="Refresh Live"
      onClick={() => original.refresh.mutate()}
      disabled={original.preparing}
    />
  );
}

function ReaderActions({
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
  return (
    <div className="silo-reader-tools">
      <IconButton name="copy" label="Copy link" onClick={actions.copy} disabled={disabled} />
      <RefreshButton original={original} />
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
  link,
}: {
  actions: Actions;
  disabled: boolean;
  trashed: boolean;
  link: LinkJson | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="silo-reader-more">
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <ReaderIcon name="more" />
      </button>
      <MenuPresence>
        {open && (
          <MenuSurface className="silo-reader-more-menu" link={link} onClose={() => setOpen(false)}>
            {!trashed && link ? (
              <LinkMenuActions
                link={link}
                onClose={() => setOpen(false)}
                onTrash={actions.trash}
                onCopy={actions.copy}
                busy={actions.busy}
              />
            ) : (
              <>
                <MenuAction
                  icon={<ReaderIcon name="external" />}
                  shortcut="o"
                  onClick={() => {
                    setOpen(false);
                    actions.open();
                  }}
                >
                  Open original
                </MenuAction>
                <MenuAction icon={<ReaderIcon name="copy" />} shortcut="c" onClick={actions.copy}>
                  Copy link
                </MenuAction>
                <div className="silo-menu-separator" />
                <MenuAction
                  icon={<ReaderIcon name={trashed ? 'restore' : 'trash'} />}
                  danger={!trashed}
                  disabled={actions.busy}
                  onClick={() => {
                    setOpen(false);
                    if (trashed) actions.restore();
                    else actions.trash();
                  }}
                >
                  {trashed ? 'Restore' : 'Move to trash'}
                </MenuAction>
              </>
            )}
          </MenuSurface>
        )}
      </MenuPresence>
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
      {video && <ReaderPlayer embed={video} url={link.url} />}
      <h2>{link.title ?? deriveTitleFromUrl(link.url)}</h2>
      <YouTubeStats source={link.sourceData} />
      <ReaderMeta key={link.id} link={link} trashed={trashed} />
      <div className="silo-reader-body-column">
        <div className="silo-reader-body-wrap">
          <ArticleBody link={link} loading={loading} />
        </div>
      </div>
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
  const shownOriginal = tab === 'original' && link ? original : undefined;
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
        <Original key={link.id} link={link} state={original} showReader={() => setTab('reader')} />
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
          <ReaderSegment id={id} tab={tab} setTab={setTab} disabled={!link} />
        </div>
        <div className="silo-reader-right">
          <div className="silo-reader-desktop">
            <ReaderActions
              actions={actions}
              disabled={!link}
              trashed={trashed}
              original={shownOriginal}
            />
          </div>
          <ReaderMore
            key={selectedId}
            actions={actions}
            disabled={!link}
            trashed={trashed}
            link={link}
          />
        </div>
      </div>
      {actions.feedback && (
        <div className="silo-toast" role="status">
          {actions.feedback}
        </div>
      )}
      {shownOriginal?.refresh.isError && (
        <div className="silo-toast" role="alert">
          Refresh failed
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
        <RefreshButton original={shownOriginal} />
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
