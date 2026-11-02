import {
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useAi, useSaveReadingPosition } from '../../../api/hooks';
import type { LinkJson } from '../../../api/types';
import { deriveTitleFromUrl } from '../../../lib/url';
import { useReaderPrefs } from '../../../lib/useReaderPrefs';
import { MenuPresence } from '../../MenuPresence';
import { MenuSurface } from '../../MenuSurface';
import { HighlightSheet } from '../highlights/HighlightSheet';
import { HighlightsLayer } from '../highlights/HighlightsLayer';
import { type HighlightsApi, useHighlights } from '../highlights/useHighlights';
import { ListenPlayer } from '../listen/ListenPlayer';
import { ListenSheet } from '../listen/ListenSheet';
import { ENGLISH_ONLY_TITLE } from '../listen/language';
import { useListenClicks } from '../listen/useListenClicks';
import { useListenKeys } from '../listen/useListenKeys';
import { type ReadAloudApi, useReadAloud } from '../listen/useReadAloud';
import { NotesLayer } from '../notes/NotesLayer';
import { type NotesLaneApi, useNotesLane } from '../notes/useNotesLane';
import { PencilOverlay } from '../pencil/PencilOverlay';
import { PencilSheet } from '../pencil/PencilSheet';
import { type PencilApi, usePencil } from '../pencil/usePencil';
import { usePencilKeys } from '../pencil/usePencilKeys';
import { SavedPlace } from '../place/SavedPlace';
import { ReaderIcon } from '../ReaderIcon';
import { DockHostContext } from './DockHostContext';
import { TypeSheet } from './TypeSheet';

const DockChat = lazy(() =>
  import('../librarian/DockChat').then((module) => ({ default: module.DockChat })),
);

// The outline rail brings the spring engine with it, so it loads only where a rail can show.
const OutlineRail = lazy(() =>
  import('../outline/OutlineRail').then((module) => ({ default: module.OutlineRail })),
);

/** What a dock tool's sheet can read. Later slices add their tools' state here. */
type DockApi = {
  pencil: PencilApi;
  highlights: HighlightsApi;
  lane: NotesLaneApi;
  listen: ReadAloudApi;
  closeSheet: () => void;
  openSheet: (id: string) => void;
};

type DockTool = {
  id: string;
  label: string;
  title: string;
  /** The sheet heading. */
  heading: string;
  /** The glyph beside the label. */
  glyph: ReactNode;
  /** The sheet the button opens. A tool with `press` and no sheet only toggles. */
  sheet?: ComponentType<{ api: DockApi }>;
  /** A tool that toggles something beside the article instead of opening a sheet. */
  press?: { on: (api: DockApi) => boolean; toggle: (api: DockApi) => void };
  /** A tool with nothing to show yet: the button stays, greyed, with this title. */
  unavailable?: { when: (api: DockApi) => boolean; title: string };
  /** A count beside the label. */
  badge?: (api: DockApi) => number;
  /** A tool with a main action beside its sheet chevron. */
  split?: {
    mainTitle: string;
    chevronTitle: string;
    on: (api: DockApi) => boolean;
    toggle: (api: DockApi) => void;
  };
};

/** Later slices add their tools here; the dock lists only tools that have shipped. */
const tools: readonly DockTool[] = [
  {
    id: 'type',
    label: 'Type',
    title: 'Type settings',
    heading: 'Typography',
    glyph: (
      <span className="silo-reader-dock-glyph" aria-hidden="true">
        Aa
      </span>
    ),
    sheet: () => <TypeSheet />,
  },
  {
    id: 'pencil',
    label: 'Pencil',
    title: 'Reading pencil',
    heading: 'Reading pencil',
    glyph: <ReaderIcon name="edit" size={19} />,
    sheet: ({ api }) => <PencilSheet pencil={api.pencil} />,
    split: {
      mainTitle: 'Reading pencil (P)',
      chevronTitle: 'Pencil settings',
      on: (api) => api.pencil.enabled,
      toggle: (api) => api.pencil.toggleEnabled(),
    },
  },
  {
    id: 'highlight',
    label: 'Highlight',
    title: 'Highlight',
    heading: 'Highlight',
    glyph: <ReaderIcon name="highlighter" size={19} />,
    sheet: ({ api }) => (
      <HighlightSheet color={api.highlights.color} setColor={api.highlights.setColor} />
    ),
  },
  {
    id: 'listen',
    label: 'Listen',
    title: 'Read aloud',
    heading: 'Read aloud',
    glyph: <ReaderIcon name="headphones" size={19} />,
    sheet: ({ api }) => <ListenSheet listen={api.listen} />,
    press: {
      on: (api) => api.listen.active,
      // Open the player and its sheet; the sheet warms the voice, and Play then starts at once.
      toggle: (api) => {
        api.listen.begin();
        api.openSheet('listen');
      },
    },
    unavailable: { when: (api) => !api.listen.english, title: ENGLISH_ONLY_TITLE },
  },
  {
    id: 'notes',
    label: 'Notes',
    title: 'Notes',
    heading: 'Notes',
    glyph: <ReaderIcon name="note" size={19} />,
    press: { on: (api) => api.lane.open, toggle: (api) => api.lane.toggle() },
    unavailable: { when: (api) => api.highlights.items.length === 0, title: 'No highlights yet' },
    badge: (api) => api.highlights.items.length,
  },
  {
    id: 'ask',
    label: 'Ask',
    title: 'Ask the Librarian',
    heading: 'Librarian',
    glyph: <ReaderIcon name="sparkles" size={19} />,
  },
];

function DockButton({
  tool,
  api,
  open,
  sheetId,
  onToggle,
}: {
  tool: DockTool;
  api: DockApi;
  open: boolean;
  sheetId: string;
  onToggle: () => void;
}) {
  const unavailable = tool.unavailable?.when(api) ?? false;
  const count = tool.badge?.(api) ?? 0;
  const pressed = tool.press?.on(api);
  return (
    <button
      type="button"
      className="silo-reader-dockbtn"
      data-tool={tool.id}
      title={unavailable ? tool.unavailable?.title : tool.title}
      aria-haspopup={tool.press ? undefined : 'dialog'}
      aria-expanded={tool.press ? undefined : open}
      aria-pressed={tool.press ? pressed : undefined}
      aria-controls={open ? sheetId : undefined}
      aria-disabled={unavailable || undefined}
      onClick={unavailable ? undefined : onToggle}
    >
      {tool.glyph}
      {tool.label}
      {count > 0 && <span className="silo-reader-dockbadge">{count}</span>}
    </button>
  );
}

/** The main part toggles the tool; the chevron opens its sheet. */
function SplitDockButton({
  tool,
  split,
  api,
  open,
  sheetId,
  onToggle,
}: {
  tool: DockTool;
  split: NonNullable<DockTool['split']>;
  api: DockApi;
  open: boolean;
  sheetId: string;
  onToggle: () => void;
}) {
  const on = split.on(api);
  return (
    <div className="silo-reader-dock-split" data-on={on}>
      <button
        type="button"
        className="silo-reader-dockbtn"
        title={split.mainTitle}
        aria-pressed={on}
        onClick={(event) => {
          split.toggle(api);
          // A click leaves focus here, where Space would press the button again instead of
          // pausing the tool. Keyboard presses keep their focus.
          if (event.detail > 0) event.currentTarget.blur();
        }}
      >
        {tool.glyph}
        {tool.label}
      </button>
      <button
        type="button"
        className="silo-reader-dockchev"
        title={split.chevronTitle}
        aria-label={split.chevronTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        onClick={onToggle}
      >
        <ReaderIcon name="down" size={14} />
      </button>
    </div>
  );
}

/** Reading positions and highlights are saved only for a live library link; trash and feed posts refuse them. */
function canSavePosition(link: LinkJson, trashed: boolean): boolean {
  return !trashed && link.feedId === null;
}

function isChatOpen(id: string | null, ready: boolean) {
  return id === 'ask' && ready;
}

function useChatFocus(open: boolean, pill: { current: HTMLDivElement | null }) {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      pill.current?.querySelector<HTMLElement>('[data-tool="ask"]')?.focus();
    }
    wasOpen.current = open;
  }, [open, pill]);
}

/**
 * A floating pill at the bottom of the reader pane. Each tool opens a sheet above it. It also
 * runs the pencil, the outline rail and the resume point, which draw in the prose and the pane.
 */
export function ReaderDock({
  link,
  prose,
  trashed = false,
}: {
  link: LinkJson;
  prose: HTMLElement | null;
  trashed?: boolean;
}) {
  const { element: host, scroll, panel } = useContext(DockHostContext);
  const [openId, setOpenId] = useState<string | null>(null);
  const sheetId = useId();
  const { data: aiStatus } = useAi();
  const askReady = aiStatus?.status?.features?.librarian?.ready === true;
  const chatOpen = isChatOpen(openId, askReady);
  const writePosition = useSaveReadingPosition(link.id);
  const [saveError, setSaveError] = useState('');
  const save = useCallback(
    async (
      position: number | null,
      options?: { source?: 'pencil' | 'listen' | 'mark'; keepalive?: boolean },
    ) => {
      try {
        await writePosition(position, options);
        setSaveError('');
      } catch (error) {
        setSaveError('Could not save your reading place. Try again.');
        throw error;
      }
    },
    [writePosition],
  );
  const savePencil = useCallback(
    (position: number, options?: { keepalive?: boolean }) =>
      save(position, { ...options, source: 'pencil' }),
    [save],
  );
  const saveListen = useCallback(
    (position: number, options?: { keepalive?: boolean }) =>
      save(position, { ...options, source: 'listen' }),
    [save],
  );
  const saveMark = useCallback(
    (position: number | null) => save(position, { source: 'mark' }),
    [save],
  );
  const {
    prefs: {
      highlight: { color: highlightColor },
    },
  } = useReaderPrefs();
  const [dialHidden, setDialHidden] = useState(false);
  const highlights = useHighlights({
    link,
    prose,
    scroll,
    writable: canSavePosition(link, trashed),
    // While the Highlight sheet is open, a selection is highlighted at once.
    autoColor: openId === 'highlight' ? highlightColor : null,
  });
  const pencil = usePencil({
    prose,
    scroll,
    saved: link.readingPosition?.position ?? null,
    canSave: canSavePosition(link, trashed),
    onSave: savePencil,
  });
  usePencilKeys(pencil);
  const lane = useNotesLane(highlights);
  const listen = useReadAloud({
    prose,
    scroll,
    saved: link.readingPosition?.position ?? null,
    canSave: canSavePosition(link, trashed),
    onSave: saveListen,
  });
  useListenKeys(listen);
  useListenClicks(prose, listen);
  // Two guides at once would fight over Space; reading aloud wins.
  const { stop: stopPencil, enabled: pencilOn } = pencil;
  const listening = listen.active;
  useEffect(() => {
    if (listening && pencilOn) stopPencil();
  }, [listening, pencilOn, stopPencil]);
  // The Listen sheet warms the voice model, so Play is instant once it is chosen.
  const { warm: warmListen } = listen;
  useEffect(() => {
    if (openId === 'listen') warmListen();
  }, [openId, warmListen]);
  // Focus follows the dock as it morphs: to Play when the player opens, back to Listen when it
  // closes. The first render does neither.
  const pill = useRef<HTMLDivElement>(null);
  useChatFocus(chatOpen, pill);
  const wasListening = useRef(false);
  useEffect(() => {
    if (listening === wasListening.current) return;
    wasListening.current = listening;
    const target = listening ? '.silo-listen-play' : '[data-tool="listen"]';
    pill.current?.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
  }, [listening]);
  // Stopping Listen closes its sheet with it.
  useEffect(() => {
    if (!listening) setOpenId((id) => (id === 'listen' ? null : id));
  }, [listening]);
  if (!host) return null;
  const closeSheet = () => setOpenId(null);
  const api: DockApi = { pencil, highlights, lane, listen, closeSheet, openSheet: setOpenId };
  const openTool = tools.find((tool) => tool.id === openId);
  const Sheet = openTool?.sheet;
  return createPortal(
    <>
      {prose && scroll && panel && (
        <Suspense fallback={null}>
          <OutlineRail prose={prose} scroll={scroll} panel={panel} hidden={dialHidden} />
        </Suspense>
      )}
      <PencilOverlay pencil={pencil} prose={prose} />
      {prose && scroll && panel && canSavePosition(link, trashed) && (
        <SavedPlace
          prose={prose}
          scroll={scroll}
          panel={panel}
          saved={link.readingPosition ?? null}
          onSave={saveMark}
          pencil={pencil}
          listen={listen}
        />
      )}
      {saveError && (
        <div className="silo-sb-toast" role="alert">
          {saveError}
        </div>
      )}
      <NotesLayer
        api={highlights}
        lane={lane}
        resumeY={null}
        panel={panel}
        onDialHidden={setDialHidden}
      />
      <HighlightsLayer
        api={highlights}
        lane={lane}
        title={link.title ?? deriveTitleFromUrl(link.url)}
        container={host}
        listen={listen}
      />
      <div className="silo-reader-dock" data-chat={chatOpen}>
        {chatOpen ? (
          <Suspense fallback={<div role="status">Loading Librarian…</div>}>
            <DockChat key={link.id} linkId={link.id} panel={panel} onFold={closeSheet} />
          </Suspense>
        ) : (
          <div
            ref={pill}
            className="silo-reader-dock-pill"
            data-mode={listen.active ? 'player' : 'tools'}
            role="toolbar"
            aria-label="Reader tools"
          >
            {listen.active ? (
              <ListenPlayer
                listen={listen}
                sheetOpen={openId === 'listen'}
                onSheet={() => setOpenId(openId === 'listen' ? null : 'listen')}
                onClose={() => {
                  listen.stop();
                  closeSheet();
                }}
              />
            ) : (
              tools
                .filter((tool) => tool.id !== 'ask' || askReady)
                .map((tool) => {
                  const toggle = () => {
                    if (tool.press) {
                      setOpenId(null);
                      tool.press.toggle(api);
                    } else setOpenId(openId === tool.id ? null : tool.id);
                  };
                  return tool.split ? (
                    <SplitDockButton
                      key={tool.id}
                      tool={tool}
                      split={tool.split}
                      api={api}
                      open={openId === tool.id}
                      sheetId={sheetId}
                      onToggle={toggle}
                    />
                  ) : (
                    <DockButton
                      key={tool.id}
                      tool={tool}
                      api={api}
                      open={openId === tool.id}
                      sheetId={sheetId}
                      onToggle={toggle}
                    />
                  );
                })
            )}
          </div>
        )}
        <MenuPresence>
          {openTool && Sheet && (
            <MenuSurface
              className="silo-type-sheet"
              role="dialog"
              label={openTool.label}
              sheet={false}
              onClose={() => setOpenId(null)}
            >
              <header className="silo-sheet-head">
                <h3>{openTool.heading}</h3>
                <button
                  type="button"
                  className="silo-reader-iconbtn"
                  aria-label="Close sheet"
                  title="Close (Esc)"
                  onClick={() => setOpenId(null)}
                >
                  <ReaderIcon name="close" size={18} />
                </button>
              </header>
              <div id={sheetId} className="silo-sheet-body">
                <Sheet api={api} />
              </div>
            </MenuSurface>
          )}
        </MenuPresence>
      </div>
    </>,
    host,
  );
}
