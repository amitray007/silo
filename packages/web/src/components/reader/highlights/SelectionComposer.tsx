import { Composer, type QuickAction } from '../librarian/Composer';

function placeholderFor(quote: string) {
  return !/\s/.test(quote) && quote.length <= 32
    ? `Ask about “${quote}”…`
    : 'Ask about this passage…';
}

/** The shared composer on the surface the selection bar grew into. */
export function SelectionComposer({
  quote,
  question,
  onChange,
  onSend,
  quick,
  onQuick,
}: {
  quote: string;
  question: string;
  onChange: (question: string) => void;
  onSend: () => void;
  quick: readonly QuickAction[];
  onQuick: (id: string, label: string) => void;
}) {
  return (
    <Composer
      className="silo-selection-compose"
      value={question}
      onChange={onChange}
      onSend={onSend}
      label="Ask about this passage"
      placeholder={placeholderFor(quote)}
      quick={quick}
      onQuick={onQuick}
    />
  );
}
