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

// jsdom does not implement `CSS.escape` (the `CSS` global itself is present,
// but its `escape` static method is not) — `CommandPaletteInner`'s
// keyboard-hover effect (CommandPalette.tsx) calls it to build the active
// row's attribute selector on every cmdk `onValueChange`, which fires as
// soon as `<Command>`'s controlled `value` mounts/changes, so any test that
// renders the palette hits this the moment cmdk reports an active item. This
// is a NARROW polyfill, not a full spec implementation — it backslash-escapes
// every non-`[A-Za-z0-9_-]` character but omits CSSOM's leading-digit /
// leading-hyphen-digit / NULL codepoint rules
// (https://drafts.csswg.org/cssom/#serialize-an-identifier). That's sufficient
// for this repo's actual values (`link:<uuid>` / `tag:<name>`, which only ever
// need the `:` escaped) and keeps the test path close to what a production
// browser's real CSS.escape would produce for those inputs; do not rely on it
// for spec-general escaping.
if (!window.CSS) {
  // @ts-expect-error -- jsdom has no global CSS at all in some environments.
  window.CSS = {};
}
if (!window.CSS.escape) {
  window.CSS.escape = (value: string): string =>
    value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
