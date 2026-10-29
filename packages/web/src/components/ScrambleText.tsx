import { useLayoutEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../lib/breakpoints';

const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DURATION_MS = 800;
const INTERVAL_MS = 40;
const FADE_MS = 200;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function needsFade(text: string) {
  return Array.from(text).some(
    (character) =>
      /\p{Letter}/u.test(character) &&
      !/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u.test(character),
  );
}

function scramble(graphemes: string[], settled: number) {
  return graphemes
    .map((grapheme, index) =>
      index < settled || /^\s+$/u.test(grapheme)
        ? grapheme
        : CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)],
    )
    .join('');
}

export function ScrambleText({
  text,
  reveal,
  className,
}: {
  text: string;
  reveal: boolean;
  className?: string;
}) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [frame, setFrame] = useState<{ title: string; text: string; fade: boolean } | null>(null);
  const handled = useRef({ text: '', reveal: false });

  useLayoutEffect(() => {
    const fresh = reveal && (!handled.current.reveal || handled.current.text !== text);
    handled.current = { text, reveal };
    if (!fresh || reducedMotion) {
      setFrame(null);
      return;
    }

    const graphemes = Array.from(segmenter.segment(text), ({ segment }) => segment);
    const fade = needsFade(text);
    const duration = fade ? FADE_MS : DURATION_MS;
    const startedAt = performance.now();
    let lastTick = 0;
    let request = 0;
    setFrame({ title: text, text: fade ? text : scramble(graphemes, 0), fade });

    const animate = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed >= duration) {
        setFrame(null);
        return;
      }
      const tick = Math.floor(elapsed / INTERVAL_MS);
      if (!fade && tick > lastTick) {
        lastTick = tick;
        setFrame({
          title: text,
          text: scramble(graphemes, Math.floor((elapsed / duration) * graphemes.length)),
          fade: false,
        });
      }
      request = requestAnimationFrame(animate);
    };
    request = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(request);
  }, [text, reveal, reducedMotion]);

  const active = reveal && !reducedMotion && frame?.title === text ? frame : null;
  return (
    <span className={className}>
      {active ? (
        <>
          <span className="silo-sr-only">{text}</span>
          <span aria-hidden="true" className={active.fade ? 'silo-title-fade' : undefined}>
            {active.text}
          </span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
