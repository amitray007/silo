import type { UIMessage } from '@ai-sdk/react';
import { useState } from 'react';
import { ReaderIcon } from '../ReaderIcon';

type Part = UIMessage['parts'][number];

export type MessageReasoning = { text: string; live: boolean; ms: number | undefined };

/** The reasoning a message carries, or null when it has none (older stored messages, non-thinking models). */
export function messageReasoning(message: UIMessage): MessageReasoning | null {
  const parts = message.parts.filter(
    (part): part is Extract<Part, { type: 'reasoning' }> =>
      part.type === 'reasoning' && part.text.trim() !== '',
  );
  if (parts.length === 0) return null;
  const meta = message.metadata;
  const ms =
    meta &&
    typeof meta === 'object' &&
    'reasoningMs' in meta &&
    typeof meta.reasoningMs === 'number'
      ? meta.reasoningMs
      : undefined;
  return {
    text: parts.map((part) => part.text.trim()).join('\n\n'),
    live: parts.at(-1)?.state === 'streaming',
    ms,
  };
}

export const thoughtLabel = (ms: number | undefined) =>
  ms === undefined ? 'Thought' : `Thought for ${Math.max(1, Math.round(ms / 1000))}s`;

/**
 * While the model reasons: a shimmering label over the tail of its text. Afterwards: a quiet
 * disclosure that opens the full text.
 */
export function Reasoning({ text, live, ms }: MessageReasoning) {
  const [open, setOpen] = useState(false);
  if (live)
    return (
      <div className="silo-reasoning">
        <span className="silo-reasoning-head silo-shimmer">Thinking</span>
        <p className="silo-reasoning-live" aria-hidden="true">
          {text}
        </p>
      </div>
    );
  return (
    <div className="silo-reasoning">
      <button
        type="button"
        className="silo-reasoning-head"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        {thoughtLabel(ms)}
        <ReaderIcon name="right" size={14} />
      </button>
      {open && <p className="silo-reasoning-full">{text}</p>}
    </div>
  );
}
