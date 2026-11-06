import type { UIMessage } from '@ai-sdk/react';
import { type ReactNode, useState } from 'react';
import { ReaderIcon } from '../ReaderIcon';
import { type MessageReasoning, thoughtLabel } from './Reasoning';
import { StatusLine } from './StatusLine';
import { StepsList, useToolSeconds } from './Steps';
import { runningLabel, runningStep, toolsUsed } from './stepRows';

type Panel = 'thought' | 'steps';

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
 * text flows, or the turn is done, it holds the "Thought" and "Used N tools" disclosures. The
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
  const [open, setOpen] = useState<Panel | null>(null);
  const running = runningStep(message);
  const seconds = useToolSeconds(running !== undefined);
  const used = toolsUsed(message);
  const label = liveLabel(running, live, answerStarted);
  const thought = reasoning !== null && !reasoning.live;
  // With nothing to show, the line goes. In a live turn that happens in the same frame the first
  // answer words arrive, so the text takes the line's place and nothing below it moves.
  if (label === null && !thought && used === 0) return null;
  const toggle = (panel: Panel) => setOpen((now) => (now === panel ? null : panel));
  return (
    <div className="silo-reasoning silo-trace">
      <div className="silo-trace-line">
        {label !== null ? (
          <StatusLine label={label} />
        ) : (
          <>
            {thought && (
              <Disclosure open={open === 'thought'} onToggle={() => toggle('thought')}>
                {thoughtLabel(reasoning.ms)}
              </Disclosure>
            )}
            {used > 0 && (
              <Disclosure open={open === 'steps'} onToggle={() => toggle('steps')}>
                Used {used} {used === 1 ? 'tool' : 'tools'}
                {seconds !== null && ` · ${seconds}s`}
              </Disclosure>
            )}
          </>
        )}
      </div>
      {label !== null && reasoning?.live === true && !answerStarted && (
        <p className="silo-reasoning-live" aria-hidden="true">
          {reasoning.text}
        </p>
      )}
      {open === 'thought' && thought && <p className="silo-reasoning-full">{reasoning.text}</p>}
      {open === 'steps' && used > 0 && <StepsList message={message} />}
    </div>
  );
}
