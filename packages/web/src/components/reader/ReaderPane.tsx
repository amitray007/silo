import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import type { LinkJson } from '../../api/types';
import { layoutMedia, useMediaQuery } from '../../lib/breakpoints';
import { purgeCountdownDays } from '../../lib/buckets';
import { deriveTitleFromUrl } from '../../lib/url';
import { useHideOnScroll } from '../../lib/useHideOnScroll';
import { useHideOnViewScroll } from '../../lib/useHideOnViewScroll';
import { useHideWhileReading } from '../../lib/useHideWhileReading';
import { useReaderWidth } from '../../lib/useReaderWidth';
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
import { ReaderSettings } from './ReaderSettings';
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
  original,
  open,
  setOpen,
}: {
  actions: Actions;
  disabled: boolean;
  trashed: boolean;
  link: LinkJson | undefined;
  original: OriginalState | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  return (
    <div className="silo-reader-more">
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <ReaderIcon name="more" />
      </button>
      <MenuPresence>
        {open && (
          <MenuSurface className="silo-reader-more-menu" link={link} onClose={() => setOpen(false)}>
            {!trashed && (
              <MenuAction
                icon={<ReaderIcon name="edit" />}
                shortcut="e"
                onClick={() => {
                  setOpen(false);
                  actions.edit();
                }}
              >
                Edit
              </MenuAction>
            )}
            {original && original.mode !== 'player' && (
              <MenuAction
                icon={<ReaderIcon name="refresh" />}
                disabled={original.preparing}
                onClick={() => {
                  setOpen(false);
                  if (link) original.refresh.mutate(link.id);
                }}
              >
                Reload page
              </MenuAction>
            )}
            {(!trashed || (original && original.mode !== 'player')) && (
              <div className="silo-menu-separator" />
            )}
            {!trashed && link ? (
              <LinkMenuActions
                link={link}
                onClose={() => setOpen(false)}
                onTrash={actions.trash}
                onCopy={actions.copy}
                showEdit={false}
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

function ArticleBody({
  topPlayerSrc,
  link,
  loading,
  trashed,
  showLive,
}: {
  topPlayerSrc?: string | undefined;
  link: LinkJson;
  loading: boolean;
  trashed: boolean;
  showLive: () => void;
}) {
  return loading ? (
    <ReaderSkeleton />
  ) : (
    <ReaderContent link={link} trashed={trashed} showLive={showLive} topPlayerSrc={topPlayerSrc} />
  );
}

function ReaderArticle({
  link,
  actions,
  trashed,
  purgeWindowDays,
  loading,
  showLive,
}: {
  link: LinkJson;
  actions: Actions;
  trashed: boolean;
  purgeWindowDays: number;
  loading: boolean;
  showLive: () => void;
}) {
  const [width] = useReaderWidth();
  const embed = embedFor(link.url, link.sourceData);
  const video = embed?.video ? embed : undefined;
  const deletedAt = 'deletedAt' in link && typeof link.deletedAt === 'string' ? link.deletedAt : '';
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: delegated native anchor clicks also fire on Enter.
    <article
      className="silo-reader"
      data-width={width}
      onClick={(event) => seekChapter(event, video)}
    >
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
          <ArticleBody
            link={link}
            loading={loading}
            trashed={trashed}
            showLive={showLive}
            topPlayerSrc={video?.src}
          />
        </div>
      </div>
    </article>
  );
}

type LiveHead = 'hidden' | 'shown' | undefined;

/**
 * Keyboard focus pins the header so focused controls stay visible. A mouse
 * click on a header control (the Reader/Live tabs) leaves focus there too, but
 * that must not stop the header from hiding while you read.
 */
function keyboardFocus(element: Element | null): boolean {
  try {
    return element?.matches(':focus-visible') ?? false;
  } catch {
    return false;
  }
}

/**
 * Reader and Live's Silo view copy hide the header on the same scroll distances.
 * Pages loaded straight from their site hide their scroll, so those use the pointer.
 * `liveHead` stays unset until Live first hides, so opening Live does not animate.
 */
function useHeadHidden({
  panelRef,
  scrollRef,
  tab,
  free,
  mode,
  resetKey,
}: {
  panelRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  tab: Tab;
  free: boolean;
  mode: OriginalState['mode'] | undefined;
  resetKey: string;
}): { hidden: boolean; liveHead: LiveHead } {
  const live = tab === 'original' && free;
  const scrolledAway = useHideOnScroll(scrollRef, tab === 'reader' && free, resetKey);
  const resting = useHideWhileReading(panelRef, live && mode === 'direct', resetKey);
  const viewScrolled = useHideOnViewScroll(panelRef, live && mode === 'view', resetKey);
  const liveHidden = resting || viewScrolled;
  const [moved, setMoved] = useState<string | null>(null);
  useEffect(() => {
    if (liveHidden) setMoved(resetKey);
    // Leaving Live forgets the slide, so returning to the same article opens still.
    else if (tab !== 'original') setMoved(null);
  }, [liveHidden, resetKey, tab]);
  let liveHead: LiveHead;
  if (liveHidden) liveHead = 'hidden';
  else if (moved === resetKey) liveHead = 'shown';
  return { hidden: scrolledAway || liveHidden, liveHead };
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
  loading: boolean;
}) {
  const phone = useMediaQuery(layoutMedia.phone);
  const fullWindow = useMediaQuery(layoutMedia.fullWindowReader);
  const original = useOriginal(link, tab === 'original');
  const shownOriginal = tab === 'original' && link ? original : undefined;
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<'more' | 'settings' | null>(null);
  const [headerFocused, setHeaderFocused] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(false);
  const wasOpen = useRef(false);
  const wasFullWindow = useRef(fullWindow);
  useEffect(() => {
    if (selectedId && fullWindow && (!wasOpen.current || !wasFullWindow.current))
      panelRef.current?.focus();
    wasOpen.current = Boolean(selectedId);
    wasFullWindow.current = fullWindow;
  }, [selectedId, fullWindow]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll when the content changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setOpenMenu(null);
    setHeaderHovered(false);
    const active = document.activeElement;
    setHeaderFocused(
      Boolean(panelRef.current?.querySelector('.silo-reader-head')?.contains(active)) &&
        keyboardFocus(active),
    );
  }, [selectedId, tab]);
  const { hidden, liveHead } = useHeadHidden({
    panelRef,
    scrollRef,
    tab,
    free: Boolean(link) && !openMenu && !headerFocused && !headerHovered,
    mode: shownOriginal?.mode,
    resetKey: `${selectedId}-${tab}`,
  });

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
          showLive={() => setTab('original')}
        />
      );
  return (
    <section
      className="silo-readerpane"
      aria-label="Link reader"
      ref={panelRef}
      tabIndex={-1}
      onPointerMove={(event) => {
        if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        const head = event.currentTarget.querySelector('.silo-reader-head');
        setHeaderHovered(
          event.clientY - event.currentTarget.getBoundingClientRect().top <= 40 ||
            Boolean(head?.contains(event.target as Node)),
        );
      }}
      onPointerLeave={() => setHeaderHovered(false)}
      onPointerOver={(event) => {
        // Moves inside the iframe never reach this document, so entering it ends header hover.
        if (event.target instanceof HTMLIFrameElement) setHeaderHovered(false);
      }}
    >
      {liveHead === 'hidden' && <div className="silo-reader-reveal" aria-hidden="true" />}
      <div
        className="silo-reader-head"
        data-hidden={hidden}
        onFocusCapture={(event) => setHeaderFocused(keyboardFocus(event.target))}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHeaderFocused(false);
        }}
      >
        <div className="silo-reader-navigation" role="toolbar" aria-label="Reader navigation">
          <div className="silo-reader-tools">
            <IconButton name="close" label="Close reader" onClick={close} disabled={!selectedId} />
            <IconButton name="up" label="Previous" onClick={() => step(-1)} disabled={index <= 0} />
            <IconButton name="down" label="Next" onClick={() => step(1)} disabled={!canGoNext} />
          </div>
        </div>
        <div className="silo-reader-viewtools">
          <ReaderSegment id={id} tab={tab} setTab={setTab} disabled={!link} />
        </div>
        <div className="silo-reader-right">
          {link && (
            <ReaderSettings
              key={`settings-${selectedId}-${tab}`}
              original={shownOriginal}
              open={openMenu === 'settings'}
              setOpen={(open) => setOpenMenu(open ? 'settings' : null)}
            />
          )}
          {!phone && (
            <div className="silo-reader-inline-actions">
              <ReaderActions actions={actions} disabled={!link} trashed={trashed} />
            </div>
          )}
          <ReaderMore
            key={selectedId}
            actions={actions}
            disabled={!link}
            trashed={trashed}
            link={link}
            original={shownOriginal}
            open={openMenu === 'more'}
            setOpen={(open) => setOpenMenu(open ? 'more' : null)}
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
        data-head={liveHead}
        ref={scrollRef}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
      >
        {content}
      </div>
    </section>
  );
}
