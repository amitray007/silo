import { ApiError } from '../../../api/client';
import { selectionActions as quickActions, requestDock } from '../librarian/selectionStore';
import { chatErrorText } from '../librarian/useLibrarianChat';
import type { useSelectionAnswer } from './useSelectionAnswer';

/** What the answer card does with a finished answer: keep it as a note, or carry it into the chat. */
export function useAnswerActions({
  answerState,
  linkId,
  passage,
  onSaveAnswer,
  onDismiss,
  onSaved,
}: {
  answerState: ReturnType<typeof useSelectionAnswer>;
  linkId: string | undefined;
  passage: { quote: string; paragraph: number };
  onSaveAnswer: ((answer: string) => Promise<void>) | undefined;
  onDismiss: () => void;
  /** Say what was saved, in a short toast. */
  onSaved: (message: string) => void;
}) {
  const { answer, answerAction, setAnswerAction, setFailure, setSaving, importTurn } = answerState;
  /** Run `work` with the saving flag up; a thrown error becomes `failure` on the card. */
  const guarded = async (work: () => Promise<void>, failure: (error: unknown) => string) => {
    setSaving(true);
    try {
      await work();
    } catch (error) {
      setFailure(failure(error));
    } finally {
      setSaving(false);
    }
  };
  const finish = () => {
    setAnswerAction(undefined);
    onDismiss();
  };
  const saveAnswer = () =>
    guarded(
      async () => {
        await onSaveAnswer?.(answer);
        onSaved(`Saved as a note on ¶${passage.paragraph}`);
        finish();
      },
      () => 'Could not save the note. Try again.',
    );
  const continueInLibrarian = () =>
    guarded(
      async () => {
        if (!linkId) return;
        const action = quickActions(passage.quote).find(([, label]) => label === answerAction)?.[0];
        const chatId = await importTurn.mutateAsync({
          linkId,
          messages: [
            {
              id: crypto.randomUUID(),
              role: 'user',
              parts: [{ type: 'text', text: answerAction ?? '' }],
              metadata: { action, ...passage },
            },
            { id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text: answer }] },
          ],
        });
        requestDock(linkId, { chatId });
        finish();
      },
      (error) =>
        error instanceof ApiError
          ? chatErrorText(error.error)
          : 'Could not continue in Librarian. Try again.',
    );
  return { saveAnswer, continueInLibrarian };
}
