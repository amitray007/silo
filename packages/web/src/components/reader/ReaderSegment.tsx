import { useLayoutEffect, useRef } from 'react';

const readerTabs = [
  { value: 'reader', label: 'Reader' },
  { value: 'original', label: 'Live' },
] as const;

export function SegmentTabs<T extends string>({
  id,
  tab,
  setTab,
  disabled,
  tabs,
  label = 'Link view',
}: {
  id: string;
  tab: T;
  setTab: (tab: T) => void;
  disabled: boolean;
  tabs: readonly { value: T; label: string }[];
  label?: string;
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
    <div className="silo-reader-segment" role="tablist" aria-label={label} ref={root}>
      <span aria-hidden="true" className="silo-reader-segment-chip" ref={chip} />
      {tabs.map(({ value, label }, index) => (
        <button
          type="button"
          role="tab"
          id={`${id}-${value}`}
          aria-controls={`${id}-panel`}
          key={value}
          aria-selected={tab === value}
          tabIndex={tab === value ? 0 : -1}
          disabled={disabled}
          onClick={() => setTab(value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const next =
                tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
                  ?.value;
              if (!next) return;
              setTab(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ReaderSegment(props: {
  id: string;
  tab: 'reader' | 'original';
  setTab: (tab: 'reader' | 'original') => void;
  disabled: boolean;
}) {
  return <SegmentTabs {...props} tabs={readerTabs} />;
}
