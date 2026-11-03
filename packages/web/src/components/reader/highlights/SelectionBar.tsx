import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLibrarianActions } from '../../../api/librarian';
import type { HighlightColor } from '../../../lib/highlights';
import { isWord, passageChips } from '../../../lib/librarianActions';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { useSurfaceMotion } from '../../../lib/useSurfaceMotion';
import { requestDock } from '../librarian/selectionStore';
import { useRecede } from '../useRecede';
import { SelectionAnswerCard } from './SelectionAnswerCard';
import { SelectionComposer } from './SelectionComposer';
import { SelectionBarTools } from './SelectionTools';
import type { SelectionAction } from './selectionActions';
import { selectionContext } from './selectionContext';
import { type SurfacePhase, surfacePlacement } from './selectionPlacement';
import { useAnswerActions } from './useAnswerActions';
import { canRetainSelection, restoreSelection, useRetainedSelection } from './useRetainedSelection';
import { selectedPassage, useSelectionAnswer } from './useSelectionAnswer';
import type { PendingSelection } from './useSelectionWatcher';
import { useTabIntoSurface } from './useTabIntoSurface';

const TOAST_MS = 1400;

function phaseOf(composer: boolean, answerAction: string | undefined): SurfacePhase {
  if (answerAction) return 'answer';
  return composer ? 'composer' : 'bar';
}

/** A short message that clears itself. */
function useToast() {
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return [toast, setToast] as const;
}

/** Escape closes the topmost layer: composer or answer, then the colour picker, then the menu, then the surface. */
function escapeStep(open: { composer: boolean; answer: boolean; picker: boolean; menu: boolean }) {
  if (open.composer) return 'composer';
  if (open.answer) return 'answer';
  if (open.picker) return 'picker';
  return open.menu ? 'menu' : 'surface';
}

/**
 * The floating surface over a text selection. It starts as the pill built from the
 * `selectionActions` registry; Ask grows the same surface into a composer, and a quick answer
 * grows it into a card. Escape steps back one phase, then closes the colour picker, then the
 * menu, then the surface; Tab from the selection moves into it.
 */
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
  unavailable,
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
  /** Action id to the reason it cannot run here, such as `listen` on an article in another language. */
  unavailable: ReadonlyMap<string, string>;
}) {
  const passage = selectedPassage(pending, prose);
  const { quote } = passage;
  const answerState = useSelectionAnswer(linkId, passage);
  const ownerActions = useLibrarianActions();
  const { composer, setComposer, answerAction, setAnswerAction, quick } = answerState;
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [toast, setToast] = useToast();
  const { saveAnswer, continueInLibrarian } = useAnswerActions({
    answerState,
    linkId,
    passage,
    onSaveAnswer,
    onDismiss,
    onSaved: setToast,
  });
  const phase = phaseOf(composer, answerAction);
  useRetainedSelection(pending?.range, phase !== 'bar');
  // Without the Custom Highlight API the passage cannot stay sharp, so nothing recedes.
  useRecede(
    container,
    'passage',
    pending !== null && phase !== 'bar' && canRetainSelection(),
    pending?.range,
  );
  const where = pending && surfacePlacement(pending.rect, phase);
  const { root, shell, begin } = useSurfaceMotion(phase, where?.flip ? 'top' : 'bottom');
  /** Change phase: the surface remembers its old shape, then morphs into the new one. */
  const morph = (change: () => void) => {
    begin();
    change();
  };
  const previousPhase = useRef(phase);
  useEffect(() => {
    if (phase === 'composer') root.current?.querySelector('textarea')?.focus();
    else if (phase === 'answer')
      root.current?.querySelector<HTMLElement>('.silo-selection-answer')?.focus();
    else if (previousPhase.current !== 'bar') {
      root.current?.querySelector<HTMLElement>('.silo-sb-ask')?.focus();
      restoreSelection(pending);
    }
    previousPhase.current = phase;
  }, [phase, root, pending]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection closes the menu.
  useEffect(() => {
    void quick.stop();
    quick.setMessages([]);
    setComposer(false);
    setAnswerAction(undefined);
    setMenu(false);
    setPicker(false);
  }, [pending?.range]);

  const closeAnswer = () => {
    void quick.stop();
    morph(() => setAnswerAction(undefined));
  };
  const escapeActions = {
    composer: () => {
      restoreSelection(pending);
      morph(() => setComposer(false));
    },
    answer: closeAnswer,
    picker: () => setPicker(false),
    menu: () => setMenu(false),
    surface: () => {
      onDismiss();
      window.getSelection()?.removeAllRanges();
    },
  };
  useEscapeLayer(pending !== null, () =>
    escapeActions[escapeStep({ composer, answer: !!answerAction, picker, menu })](),
  );

  useTabIntoSurface(pending !== null, root);

  if (!pending && !toast) return null;

  const handlers = {
    onHighlight,
    onNote,
    onDismiss,
    onSearch,
    onListen,
    onCopied: setToast,
  };
  const run = (action: SelectionAction) => {
    const ctx = pending && prose && selectionContext({ pending, prose, title, color, handlers });
    if (ctx) action.run(ctx);
  };
  const ask = () => {
    if (!linkId) return;
    if (chatOpen) {
      requestDock(linkId, { passage });
      onDismiss();
    } else morph(() => setComposer(true));
  };
  const sendQuestion = () => {
    if (!answerState.question.trim() || !linkId) return;
    requestDock(linkId, { passage, question: answerState.question });
    setComposer(false);
    onDismiss();
  };
  return createPortal(
    <>
      {pending && where && (
        <div
          ref={root}
          className="silo-sb"
          data-selection-bar
          data-reader-menu
          data-flip={where.flip}
          data-phase={phase}
          role="toolbar"
          aria-label="Selection"
          style={
            {
              '--selection-left': `${where.left}px`,
              '--selection-top': `${where.top}px`,
              '--selection-max': `${where.maxHeight}px`,
            } as React.CSSProperties
          }
        >
          <div ref={shell} className="silo-sb-shell">
            <div key={phase} className="silo-sb-content">
              {phase === 'composer' && (
                <SelectionComposer
                  quote={quote}
                  error={answerState.error}
                  question={answerState.question}
                  onChange={answerState.setQuestion}
                  onSend={sendQuestion}
                  quick={passageChips(ownerActions, isWord(quote))}
                  onQuick={(id, label) => morph(() => answerState.runQuick(id, label))}
                />
              )}
              {phase === 'answer' && (
                <SelectionAnswerCard
                  action={answerAction ?? ''}
                  quote={quote}
                  messages={quick.messages}
                  busy={answerState.busy}
                  error={answerState.error}
                  saveDisabled={!answerState.answer || answerState.saving}
                  onClose={closeAnswer}
                  onStop={() => void quick.stop()}
                  onSave={saveAnswer}
                  onContinue={continueInLibrarian}
                />
              )}
              {phase === 'bar' && (
                <SelectionBarTools
                  askReady={askReady && !!linkId}
                  color={color}
                  blocked={blocked}
                  picker={picker}
                  setPicker={setPicker}
                  menu={menu}
                  setMenu={setMenu}
                  unavailable={unavailable}
                  onRun={run}
                  onPick={onPick}
                  onAsk={ask}
                />
              )}
            </div>
          </div>
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
