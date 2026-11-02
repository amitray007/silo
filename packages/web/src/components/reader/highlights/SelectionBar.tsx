import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { type FocusEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiUrl } from '../../../api/client';
import { useImportLibrarianTurn } from '../../../api/librarian';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../../lib/highlights';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { ChatMessage } from '../librarian/ChatMessage';
import { selectionActions as quickActions, requestDock } from '../librarian/selectionStore';
import { ReaderIcon } from '../ReaderIcon';
import { paragraphNumber } from './paragraphs';
import { type SelectionAction, type SelectionContext, selectionActions } from './selectionActions';
import type { PendingSelection } from './useSelectionWatcher';

/** The pill sits 50px above a selection, or 14px below it when there is no room above. */
const FLIP_BELOW = 70;
const TOAST_MS = 1400;
/** Half the widest the pill can be, so it stays inside the window. */
const HALF_WIDTH = 170;

function placement(rect: DOMRect, width = HALF_WIDTH * 2) {
  const half = Math.min(width, window.innerWidth - 32) / 2;
  const flip = rect.top < FLIP_BELOW;
  return {
    flip,
    left: Math.min(Math.max(rect.left + rect.width / 2, half + 16), window.innerWidth - half - 16),
    top: flip ? rect.bottom + 14 : rect.top - 50,
  };
}

/** The colour choices that open beside the Highlight button. */
function ColorPicker({
  color,
  blocked,
  onPick,
}: {
  color: HighlightColor;
  /** Colours used by highlights this selection overlaps: off, so picking never recolours quietly. */
  blocked: ReadonlySet<HighlightColor>;
  onPick: (color: HighlightColor) => void;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const swatches = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button'));
    const at = swatches.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    swatches[(at + step + swatches.length) % swatches.length]?.focus();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of colour buttons, not a fieldset.
    <div className="silo-sb-picker" role="group" aria-label="Highlight colour" onKeyDown={move}>
      {HIGHLIGHT_COLORS.map((swatch) => {
        const taken = blocked.has(swatch);
        return (
          <button
            key={swatch}
            type="button"
            className="silo-dot14"
            data-color={swatch}
            aria-label={swatch}
            aria-pressed={color === swatch}
            title={taken ? 'Used by an overlapping highlight' : swatch}
            disabled={taken}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(swatch)}
          />
        );
      })}
    </div>
  );
}

/** One primary action. The Highlight action also owns the colour picker beside it. */
function PrimaryAction({
  action,
  icons,
  color,
  blocked,
  picker,
  setPicker,
  onRun,
  onPick,
}: {
  action: SelectionAction;
  icons?: boolean;
  color: HighlightColor;
  blocked: ReadonlySet<HighlightColor>;
  /** The colour picker is open. The bar owns it, so Escape can close it before the bar. */
  picker: boolean;
  setPicker: (open: boolean) => void;
  onRun: () => void;
  onPick: (color: HighlightColor) => void;
}) {
  const timers = useRef<{ open?: number; close?: number }>({});
  const schedule = (open: boolean, delay: number) => {
    window.clearTimeout(timers.current.close);
    window.clearTimeout(timers.current.open);
    const key = open ? 'open' : 'close';
    timers.current[key] = window.setTimeout(() => setPicker(open), delay);
  };
  useEffect(
    () => () => {
      window.clearTimeout(timers.current.open);
      window.clearTimeout(timers.current.close);
    },
    [],
  );
  const hasColors = Boolean(action.colors);
  const hover = hasColors
    ? {
        onMouseEnter: () => schedule(true, 120),
        onMouseLeave: () => schedule(false, 150),
        onBlur: (event: FocusEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget)) schedule(false, 0);
        },
      }
    : {};
  const buttonKeys = hasColors
    ? {
        onFocus: () => schedule(true, 0),
        onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== 'ArrowUp') return;
          event.preventDefault();
          setPicker(true);
          const item = event.currentTarget.closest('.silo-sb-item');
          requestAnimationFrame(() =>
            item?.querySelector<HTMLElement>('.silo-sb-picker [aria-pressed="true"]')?.focus(),
          );
        },
      }
    : {};
  return (
    <div className="silo-sb-item" {...hover}>
      <button
        type="button"
        className="silo-sb-btn"
        title={action.label}
        aria-label={action.label}
        aria-haspopup={hasColors ? 'true' : undefined}
        aria-expanded={hasColors ? picker : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRun}
        {...buttonKeys}
      >
        <span className="silo-sb-icon" data-color={hasColors ? color : undefined}>
          <ReaderIcon name={action.icon} size={17} />
          {hasColors && <i />}
        </span>
        {!icons && <span>{action.label}</span>}
      </button>
      {hasColors && picker && <ColorPicker color={color} blocked={blocked} onPick={onPick} />}
    </div>
  );
}

/** The "..." menu: icon, title at 500 weight, and one muted line. */
function MoreMenu({
  actions,
  onRun,
}: {
  actions: readonly SelectionAction[];
  onRun: (action: SelectionAction) => void;
}) {
  return (
    <div className="silo-sb-menu" role="menu">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onRun(action)}
        >
          <ReaderIcon name={action.icon} size={17} />
          <span>
            <strong>{action.label}</strong>
            <small>{action.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The floating pill over a text selection, built from the `selectionActions` registry. Escape
 * closes the colour picker, then the menu, then the pill; Tab from the selection moves into it.
 */
function useSelectionAnswer(
  linkId: string | undefined,
  passage: { quote: string; paragraph: number },
) {
  const [composer, setComposer] = useState(false);
  const [question, setQuestion] = useState('');
  const [answerAction, setAnswerAction] = useState<string>();
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const importTurn = useImportLibrarianTurn();
  const quick = useChat({
    transport: new DefaultChatTransport({
      api: apiUrl('/api/librarian/quick'),
      credentials: 'include',
      headers: { 'X-Silo-CSRF': '1' },
      prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }),
    }),
  });
  const busy = quick.status === 'submitted' || quick.status === 'streaming';
  const answer = quick.messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])))
    .join('\n');
  const runQuick = (action: string, label: string) => {
    quick.setMessages([]);
    quick.clearError();
    setFailure('');
    setAnswerAction(label);
    setComposer(false);
    void quick.sendMessage({ text: label }, { body: { linkId, action, ...passage } });
  };
  return {
    composer,
    setComposer,
    question,
    setQuestion,
    answerAction,
    setAnswerAction,
    failure,
    setFailure,
    saving,
    setSaving,
    importTurn,
    quick,
    busy,
    answer,
    runQuick,
  };
}
function restoreSelection(pending: PendingSelection | null) {
  if (!pending) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(pending.range);
}
function useRetainedSelection(range: Range | undefined, active: boolean) {
  useEffect(() => {
    if (
      !range ||
      !active ||
      typeof CSS === 'undefined' ||
      !('highlights' in CSS) ||
      typeof Highlight === 'undefined'
    )
      return;
    const mark = new Highlight(range);
    mark.priority = 15;
    CSS.highlights.set('silo-librarian-selection', mark);
    return () => {
      CSS.highlights.delete('silo-librarian-selection');
    };
  }, [range, active]);
}
function AnswerError({ failed, failure }: { failed: boolean; failure: string }) {
  return failed || failure ? <p role="alert">{failure || 'Could not answer. Try again.'}</p> : null;
}
function selectedPassage(pending: PendingSelection | null, prose: HTMLElement | null) {
  return {
    quote: pending?.range.toString().trim() ?? '',
    paragraph: pending && prose ? paragraphNumber(prose, pending.range.startContainer) : 0,
  };
}
function answerTop(rect: DOMRect) {
  return Math.max(
    16,
    Math.min(rect.bottom + 14, window.innerHeight - Math.min(360, window.innerHeight * 0.55) - 16),
  );
}
function selectionPanelWidth(composer: boolean, answer: boolean) {
  if (answer) return 448;
  return composer ? 384 : 340;
}
function questionPlaceholder(quote: string) {
  return !/\s/.test(quote) && quote.length <= 32
    ? `Ask about “${quote}”…`
    : 'Ask about this passage…';
}

export function SelectionBar({
  pending,
  linkId,
  askReady = false,
  chatOpen = false,
  onSaveAnswer,
  prose,
  container,
  title,
  color,
  blocked,
  onHighlight,
  onPick,
  onNote,
  onDismiss,
  onSearch,
  onListen,
  hidden,
}: {
  pending: PendingSelection | null;
  linkId?: string;
  askReady?: boolean;
  chatOpen?: boolean;
  onSaveAnswer?: (answer: string) => Promise<void>;
  prose: HTMLElement | null;
  container: HTMLElement;
  title: string;
  color: HighlightColor;
  blocked: ReadonlySet<HighlightColor>;
  /** Highlight with the current colour; an overlap may move it to the next free one. */
  onHighlight: (color: HighlightColor) => void;
  /** A colour picked on purpose: applied as is. */
  onPick: (color: HighlightColor) => void;
  onNote: () => void;
  onDismiss: () => void;
  onSearch: (phrase: string) => void;
  /** Read aloud from the selection. */
  onListen: () => void;
  /** Action ids to leave out, such as `listen` for an article that cannot be read aloud. */
  hidden: ReadonlySet<string>;
}) {
  const passage = selectedPassage(pending, prose);
  const { quote, paragraph } = passage;
  const {
    composer,
    setComposer,
    question,
    setQuestion,
    answerAction,
    setAnswerAction,
    failure,
    setFailure,
    saving,
    setSaving,
    importTurn,
    quick,
    busy,
    answer,
    runQuick,
  } = useSelectionAnswer(linkId, passage);
  useRetainedSelection(pending?.range, composer || !!answerAction);
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [toast, setToast] = useState('');
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (composer) bar.current?.querySelector('input')?.focus();
  }, [composer]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection closes the menu.
  useEffect(() => {
    setComposer(false);
    setAnswerAction(undefined);
    setMenu(false);
    setPicker(false);
  }, [pending?.range]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Escape closes the colour picker, then the menu, then the bar, and only the top layer hears it.
  useEscapeLayer(pending !== null, () => {
    if (composer) {
      restoreSelection(pending);
      setComposer(false);
    } else if (answerAction) {
      void quick.stop();
      setAnswerAction(undefined);
    } else if (picker) setPicker(false);
    else if (menu) setMenu(false);
    else {
      onDismiss();
      window.getSelection()?.removeAllRanges();
    }
  });

  // Tab from the selection moves into the toolbar.
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab' || event.shiftKey || bar.current?.contains(document.activeElement))
        return;
      const first = bar.current?.querySelector<HTMLElement>('button');
      if (!first) return;
      event.preventDefault();
      first.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending]);

  if (!pending && !toast) return null;
  const where = pending
    ? placement(pending.rect, selectionPanelWidth(composer, !!answerAction))
    : null;

  const context = (): SelectionContext | null => {
    if (!pending || !prose) return null;
    return {
      text: pending.range.toString().replace(/\s+/g, ' ').trim(),
      paragraph: paragraphNumber(prose, pending.range.startContainer),
      title,
      color,
      highlight: onHighlight,
      note: onNote,
      copy: (text, done) => {
        void navigator.clipboard?.writeText(text);
        setToast(done);
        onDismiss();
        window.getSelection()?.removeAllRanges();
      },
      listen: () => {
        onListen();
        onDismiss();
        window.getSelection()?.removeAllRanges();
      },
      search: (phrase) => {
        onDismiss();
        onSearch(phrase);
      },
    };
  };
  const run = (action: SelectionAction) => {
    const ctx = context();
    if (ctx) action.run(ctx);
  };

  return createPortal(
    <>
      {pending && where && (
        <div
          ref={bar}
          className="silo-sb"
          data-selection-bar
          data-reader-menu
          data-flip={where.flip}
          data-answer={!!answerAction}
          role="toolbar"
          aria-label="Selection"
          style={
            {
              '--selection-left': `${where.left}px`,
              '--selection-top': `${answerAction ? answerTop(pending.rect) : where.top}px`,
            } as React.CSSProperties
          }
        >
          {composer ? (
            <form
              className="silo-selection-compose"
              onSubmit={(event) => {
                event.preventDefault();
                if (question.trim() && linkId) {
                  requestDock(linkId, { passage, question });
                  setComposer(false);
                  onDismiss();
                }
              }}
            >
              <div>
                <ReaderIcon name="sparkles" size={17} />
                <input
                  aria-label="Ask about this passage"
                  placeholder={questionPlaceholder(quote)}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                />
                <button type="submit" aria-label="Send" disabled={!question.trim()}>
                  ↑
                </button>
              </div>
              <div className="silo-chat-actions">
                {quickActions(quote).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => runQuick(id, label)}>
                    {label}
                  </button>
                ))}
              </div>
            </form>
          ) : answerAction ? (
            <section className="silo-selection-answer" aria-label="Passage answer">
              <header>
                <ReaderIcon name="sparkles" size={17} />
                {answerAction}
                <button
                  type="button"
                  aria-label="Close answer"
                  onClick={() => {
                    void quick.stop();
                    setAnswerAction(undefined);
                  }}
                >
                  ×
                </button>
              </header>
              <blockquote>{quote}</blockquote>
              {quick.messages
                .filter((m) => m.role === 'assistant')
                .map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
              {busy && <p role="status">Answering…</p>}
              <AnswerError failed={!!quick.error} failure={failure} />
              <footer>
                <button
                  type="button"
                  disabled={busy || !answer || saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onSaveAnswer?.(answer);
                      setToast(`Saved as a note on ¶${paragraph}`);
                      setAnswerAction(undefined);
                      onDismiss();
                    } catch {
                      setFailure('Could not save the note. Try again.');
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save as note
                </button>
                <button
                  type="button"
                  disabled={busy || !answer || saving}
                  onClick={async () => {
                    if (!linkId) return;
                    setSaving(true);
                    try {
                      const action = quickActions(quote).find(
                        ([, label]) => label === answerAction,
                      )?.[0];
                      const importedChatId = await importTurn.mutateAsync({
                        linkId,
                        messages: [
                          {
                            id: crypto.randomUUID(),
                            role: 'user',
                            parts: [{ type: 'text', text: answerAction }],
                            metadata: { action, ...passage },
                          },
                          {
                            id: crypto.randomUUID(),
                            role: 'assistant',
                            parts: [{ type: 'text', text: answer }],
                          },
                        ],
                      });
                      requestDock(linkId, { chatId: importedChatId });
                      setAnswerAction(undefined);
                      onDismiss();
                    } catch {
                      setFailure('Could not continue in Librarian. Try again.');
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Continue in Librarian
                </button>
              </footer>
            </section>
          ) : (
            <>
              {selectionActions
                .filter((action) => action.group === 'primary' && !hidden.has(action.id))
                .map((action) => (
                  <PrimaryAction
                    key={action.id}
                    action={action}
                    icons={askReady}
                    color={color}
                    blocked={blocked}
                    picker={picker}
                    setPicker={setPicker}
                    onRun={() => run(action)}
                    onPick={onPick}
                  />
                ))}
              <span className="silo-sb-divider" />
              {askReady && linkId && (
                <button
                  type="button"
                  className="silo-sb-btn"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (chatOpen) {
                      requestDock(linkId, { passage });
                      onDismiss();
                    } else setComposer(true);
                  }}
                >
                  <ReaderIcon name="sparkles" size={17} />
                  Ask
                </button>
              )}
              <button
                type="button"
                className="silo-sb-btn silo-sb-more"
                aria-label="More"
                aria-haspopup="menu"
                aria-expanded={menu}
                title="More"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setMenu((open) => !open)}
              >
                <ReaderIcon name="more" size={17} />
              </button>
              {menu && (
                <MoreMenu
                  actions={selectionActions.filter(
                    (action) => action.group === 'more' && !hidden.has(action.id),
                  )}
                  onRun={run}
                />
              )}
            </>
          )}
        </div>
      )}
      {toast && (
        <div className="silo-sb-toast" role="status">
          {toast}
        </div>
      )}
    </>,
    container,
  );
}
