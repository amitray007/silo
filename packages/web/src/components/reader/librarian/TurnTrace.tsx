import type { UIMessage } from '@ai-sdk/react';
import { type ReactNode, useState } from 'react';
import { ReaderIcon } from '../ReaderIcon';
import { type MessageReasoning, thoughtLabel } from './Reasoning';
import { StatusLine } from './StatusLine';
import { StepsList, useToolSeconds } from './Steps';
import { runningLabel, runningStep, toolsUsed } from './stepRows';

/** One label for a finished turn: "Thought for 1s · Used 2 tools", with either part alone when the other is missing. */
function traceSummary(thought: string | null, used: number, seconds: number | null) {
  const tools =
    used > 0 &&
    `Used ${used} ${used === 1 ? 'tool' : 'tools'}${seconds === null ? '' : ` · ${seconds}s`}`;
  return [thought, tools].filter(Boolean).join(' · ');
}

function Disclosure({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="silo-reasoning-head" aria-expanded={open} onClick={onToggle}>
      {children}
      <ReaderIcon name="right" size={12} />
    </button>
  );
}

/** The shimmering words for a live turn: the running tool, else Thinking until answer text flows. */
function liveLabel(running: ReturnType<typeof runningStep>, live: boolean, answerStarted: boolean) {
  if (!live) return null;
  if (running) return runningLabel(running);
  return answerStarted ? null : 'Thinking';
}

/**
 * The one fixed-height line above an answer. While the turn runs it holds a shimmering label that
 * changes words in place (Thinking, then the running tool, then Thinking again); once the answer
 * text flows, or the turn is done, it holds one disclosure, "Thought for Ns · Used N tools", over both panels. The
 * line never changes height while it shows, so nothing below it moves; an answer that used no
 * tools and showed no reasoning has no line at all. The live reasoning tail hangs over the
 * answer's empty space instead of pushing it, and goes away when the answer text starts.
 */
export function TurnTrace({
  message,
  reasoning,
  live,
  answerStarted,
}: {
  message: UIMessage;
  reasoning: MessageReasoning | null;
  /** The turn is still running and no approval waits on the reader. */
  live: boolean;
  /** Answer text (after the last tool call) has begun to arrive. */
  answerStarted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const running = runningStep(message);
  const seconds = useToolSeconds(running !== undefined);
  const used = toolsUsed(message);
  const label = liveLabel(running, live, answerStarted);
  const thought = reasoning !== null && !reasoning.live;
  // With nothing to show, the line goes. In a live turn that happens in the same frame the first
  // answer words arrive, so the text takes the line's place and nothing below it moves.
  if (label === null && !thought && used === 0) return null;
  return (
    <div className="silo-reasoning silo-trace">
      <div className="silo-trace-line">
        {label !== null ? (
          <StatusLine label={label} />
        ) : (
          <Disclosure open={open} onToggle={() => setOpen((now) => !now)}>
            {traceSummary(thought ? thoughtLabel(reasoning.ms) : null, used, seconds)}
          </Disclosure>
        )}
      </div>
      {label !== null && reasoning?.live === true && !answerStarted && (
        <p className="silo-reasoning-live" aria-hidden="true">
          {reasoning.text}
        </p>
      )}
      {open && thought && <p className="silo-reasoning-full">{reasoning.text}</p>}
      {open && used > 0 && <StepsList message={message} />}
    </div>
  );
}
