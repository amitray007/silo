import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useState } from 'react';
import { apiUrl } from '../../../api/client';
import { useImportLibrarianTurn } from '../../../api/librarian';
import { splitSteps } from '../librarian/ChatMessage';
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
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const importTurn = useImportLibrarianTurn();
  const quick = useChat({
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
  const error = failure || (quick.error ? 'Could not answer. Try again.' : '');
  const runQuick = (action: string, label: string) => {
    void quick.stop();
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
    error,
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
