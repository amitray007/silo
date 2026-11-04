import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { BundledTheme } from 'shiki';
import type { PluginConfig } from 'streamdown';
import { mermaidConfig } from '../diagramPalette';

type Block = 'code' | 'math' | 'mermaid';

/** Quiet themes that sit on the neutral Oat palette; reader-librarian.css picks the pair by `data-theme`. */
export const codeThemes = ['vitesse-light', 'vitesse-dark'] satisfies [BundledTheme, BundledTheme];

const loaders: { [B in Block]: () => Promise<NonNullable<PluginConfig[B]>> } = {
  code: () => import('@streamdown/code').then((m) => m.createCodePlugin({ themes: codeThemes })),
  mermaid: () => import('@streamdown/mermaid').then((m) => m.mermaid),
  math: () =>
    Promise.all([import('@streamdown/math'), import('katex/dist/katex.min.css')]).then(([m]) =>
      m.createMathPlugin(),
    ),
};

const triggers: Record<Block, RegExp> = {
  code: /^\s*(```|~~~)/m,
  mermaid: /^\s*(```|~~~)\s*(mermaid|mmd)\b/im,
  math: /\$\$/,
};

let loaded: PluginConfig = {};
const requested = new Set<Block>();
const listeners = new Set<() => void>();

function load(block: Block) {
  if (requested.has(block)) return;
  requested.add(block);
  loaders[block]().then(
    (plugin) => {
      loaded = { ...loaded, [block]: plugin };
      for (const notify of listeners) notify();
    },
    // A failed chunk leaves the block as plain text; the next answer may retry.
    () => requested.delete(block),
  );
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

function subscribeTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const currentTheme = () => document.documentElement.dataset.theme ?? '';

const wantedBlocks = (answer: string) =>
  (Object.keys(triggers) as Block[]).filter((block) => triggers[block].test(answer));

/**
 * Streamdown plugins for the blocks this answer holds: highlighted code, Mermaid, LaTeX.
 * Each loads on first use, so an answer without them never pays for Shiki, Mermaid or KaTeX.
 */
export function useRichBlocks(answer: string): PluginConfig {
  const plugins = useSyncExternalStore(subscribe, () => loaded);
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const wanted = wantedBlocks(answer).join();
  useEffect(() => {
    for (const block of wanted.split(',')) if (block) load(block as Block);
  }, [wanted]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `theme` is the trigger, not an input.
  return useMemo(() => {
    const { mermaid, ...rest } = plugins;
    if (!mermaid) return rest;
    // Streamdown skips a re-render unless `plugins` changes, so the diagram's colours ride on a
    // new plugin object: read the Oat colours at draw time and swap the object when the theme flips.
    return {
      ...rest,
      mermaid: {
        ...mermaid,
        getMermaid: () => mermaid.getMermaid(mermaidConfig(document.documentElement)),
      },
    };
  }, [plugins, theme]);
}
