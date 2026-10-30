import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

/** The native link remains the keyboard target; its context gesture opens the shared menu. */
export function SidebarContextMenu({
  children,
  onOpen,
}: {
  children: ReactNode;
  onOpen: (anchor: HTMLElement) => void;
}) {
  function open(event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) {
    const anchor = event.currentTarget.querySelector<HTMLElement>('a[href]');
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    anchor.focus();
    onOpen(anchor);
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: delegates context gestures from the native link inside this wrapper.
    <div
      onContextMenu={open}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
      }}
    >
      {children}
    </div>
  );
}
