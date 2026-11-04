import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../../api/client';
import { useImportLibrarianTurn, useRefreshOnRemovedAction } from '../../../api/librarian';
import { STREAM_UPDATE_MS } from '../../../lib/motion';
import { splitSteps } from '../librarian/tools';
import { chatErrorText } from '../librarian/useLibrarianChat';
import { paragraphNumber } from './paragraphs';
import type { PendingSelection } from './useSelectionWatcher';

type Passage = { quote: string; paragraph: number };

/** The passage a selection covers: its trimmed text and the paragraph it starts in. */
export function selectedPassage(pending: PendingSelection | null, prose: HTMLElement | null) {
  return {
    quote: pending?.range.toString().trim() ?? '',
    paragraph: pending && prose ? paragraphNumber(prose, pending.range.startContainer) : 0,
  };
}

/** The selection composer's state and its quick answer, a short stream kept apart from the chat. */
export function useSelectionAnswer(linkId: string | undefined, passage: Passage) {
  const [composer, setComposer] = useState(false);
  const [question, setQuestion] = useState('');
  const [answerAction, setAnswerAction] = useState<string>();
  /** The id of the action that produced the answer: a custom action's id is not its label. */
  const [answerId, setAnswerId] = useState<string>();
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const importTurn = useImportLibrarianTurn();
  const quick = useChat({
    throttle: STREAM_UPDATE_MS,
    id: JSON.stringify([linkId, passage.quote, passage.paragraph]),
    transport: new DefaultChatTransport({
      api: apiUrl('/api/librarian/quick'),
      credentials: 'include',
      headers: { 'X-Silo-CSRF': '1' },
      prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }),
    }),
  });
  useEffect(
    () => () => {
      void quick.stop();
    },
    [quick.stop],
  );
  const busy = quick.status === 'submitted' || quick.status === 'streaming';
  // Only the text after the last tool call is the answer; text before it is the model thinking aloud.
  const answer = quick.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => splitSteps(m).answer)
    .filter(Boolean)
    .join('\n\n');
  useRefreshOnRemovedAction(quick.error?.message);
  const recoverRemovedAction = useCallback(() => {
    quick.setMessages([]);
    quick.clearError();
    setFailure(chatErrorText('unknown_action'));
    setAnswerAction(undefined);
    setAnswerId(undefined);
    setComposer(true);
  }, [quick.setMessages, quick.clearError]);
  useEffect(() => {
    if (!/\bunknown_action\b/.test(quick.error?.message ?? '')) return;
    recoverRemovedAction();
  }, [quick.error, recoverRemovedAction]);
  const error = failure || (quick.error ? chatErrorText(quick.error.message) : '');
  const runQuick = (action: string, label: string) => {
    void quick.stop();
    quick.setMessages([]);
    quick.clearError();
    setFailure('');
    setAnswerAction(label);
    setAnswerId(action);
    setComposer(false);
    void quick.sendMessage({ text: label }, { body: { linkId, action, ...passage } });
  };
  return {
    composer,
    setComposer,
    question,
    setQuestion,
    answerAction,
    answerId,
    setAnswerAction,
    failure,
    error,
    setFailure,
    saving,
    setSaving,
    importTurn,
    quick,
    busy,
    answer,
    runQuick,
    recoverRemovedAction,
  };
}
