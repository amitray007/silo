// THROWAWAY: silent sentence playback for the saved-place mockup. No voice downloads or API.
import { useEffect, useMemo, useState } from 'react';
import { scrollToRange } from './useProseRoot';
import { buildSegments, type ReadAloudApi } from './useReadAloud';
import type { SavedPlaceApi } from './useSavedPlace';

export function useMockListen(
  prose: HTMLElement | null,
  scroll: HTMLElement,
  base: ReadAloudApi,
  place: SavedPlaceApi,
): ReadAloudApi {
  const segments = useMemo(() => (prose ? buildSegments(prose) : []), [prose]);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState(1);
  const [voiceId, setVoiceId] = useState('mock');
  const current = segments[index];
  const stopAt = () => {
    place.save(current?.block, 'listen', index);
    setPlaying(false);
  };
  const startAt = (at: number) => {
    place.continueFrom();
    setIndex(Math.min(segments.length - 1, Math.max(0, at)));
    setActive(true);
    setPlaying(true);
  };
  const open = () => {
    const saved = place.saved;
    const at = saved
      ? (saved.sentence ??
        segments.findIndex((s) => place.paragraphs[saved.paragraph]?.contains(s.block)))
      : segments.findIndex(
          (s) => s.block.getBoundingClientRect().top >= scroll.getBoundingClientRect().top + 30,
        );
    startAt(Math.max(0, at));
  };
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => {
        if (index < segments.length - 1) setIndex(index + 1);
        else setPlaying(false);
      },
      Math.max(2500, (current?.text.length ?? 30) * 65) / rate,
    );
    return () => clearTimeout(timer);
  }, [playing, index, segments.length, current, rate]);
  useEffect(() => {
    if (!current || !active) return;
    scrollToRange(scroll, current.range);
  }, [current, active, scroll]);
  useEffect(() => {
    if (!current || !active || !playing || !('highlights' in CSS)) return;
    CSS.highlights.set('proto-speak', new Highlight(current.range));
    return () => {
      CSS.highlights.delete('proto-speak');
    };
  }, [current, active, playing]);
  return {
    ...base,
    active,
    playing,
    index,
    segments,
    current,
    rate,
    setRate,
    status: 'ready',
    buffering: false,
    error: '',
    stats: {},
    engines: [{ id: 'kokoro', label: 'Preview' }],
    engineId: 'kokoro',
    setEngine: () => {},
    voices: [{ id: 'mock', label: 'Preview', language: 'en' }],
    voiceId,
    setVoiceId,
    open,
    play: () => setPlaying(true),
    pause: stopAt,
    toggle: () => (playing ? stopAt() : setPlaying(true)),
    stop: () => {
      stopAt();
      setActive(false);
    },
    next: () => setIndex(Math.min(segments.length - 1, index + 1)),
    prev: () => setIndex(Math.max(0, index - 1)),
    jump: setIndex,
    startAt,
    startHere: open,
    retry: open,
    faster: () => setRate(Math.min(3, rate + 0.25)),
    slower: () => setRate(Math.max(0.5, rate - 0.25)),
  };
}
