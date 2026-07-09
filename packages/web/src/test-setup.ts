// jsdom does not implement matchMedia; the theme system reads
// `prefers-color-scheme` through it, so tests need a stand-in.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}

// jsdom does not implement ResizeObserver; `cmdk` (CommandPalette.tsx, the
// cmdk rebuild) observes its list's height internally to drive the
// `--cmdk-list-height` CSS variable — without a stand-in, mounting
// `<Command>` in a test throws `ReferenceError: ResizeObserver is not
// defined` the moment its effect runs. A no-op stub is enough: no test here
// asserts on layout/height, only on DOM content and interaction, so the
// observer never needs to actually fire a callback.
if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom does not implement Element.scrollIntoView either; `cmdk` calls it to
// keep the active row visible whenever the selected item changes (keyboard
// nav, a filtered-out active row, etc.) — same "throws the moment the real
// interaction runs" story as ResizeObserver above. A no-op stub is enough:
// no test here asserts on scroll position.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
