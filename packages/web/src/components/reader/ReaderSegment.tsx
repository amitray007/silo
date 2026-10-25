import { useLayoutEffect, useRef } from 'react';

type Tab = 'reader' | 'original';

export function ReaderSegment({
  id,
  tab,
  setTab,
  disabled,
}: {
  id: string;
  tab: Tab;
  setTab: (tab: Tab) => void;
  disabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    let mounted = true;
    const update = () => {
      if (!mounted) return;
      const button = document.getElementById(`${id}-${tab}`);
      if (!button || !chip.current || !root.current) return;
      const box = button.getBoundingClientRect();
      const origin = root.current.getBoundingClientRect();
      chip.current.style.width = `${box.width}px`;
      chip.current.style.transform = `translateX(${box.left - origin.left - 2}px)`;
    };
    update();
    void document.fonts?.ready.then(update);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (root.current) observer?.observe(root.current);
    return () => {
      mounted = false;
      observer?.disconnect();
    };
  }, [id, tab]);
  return (
    <div className="silo-reader-segment" role="tablist" aria-label="Link view" ref={root}>
      <span aria-hidden="true" className="silo-reader-segment-chip" ref={chip} />
      {(['reader', 'original'] as const).map((value) => (
        <button
          type="button"
          role="tab"
          id={`${id}-${value}`}
          aria-controls={`${id}-panel`}
          key={value}
          aria-selected={tab === value}
          disabled={disabled}
          onClick={() => setTab(value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const next = value === 'reader' ? 'original' : 'reader';
              setTab(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }
          }}
        >
          {value === 'reader' ? 'Reader' : 'Live'}
        </button>
      ))}
    </div>
  );
}
