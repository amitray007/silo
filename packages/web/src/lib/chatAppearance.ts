import type { CSSProperties } from 'react';
import { createPrefStore, isRecord, usePref } from './prefStore';

type ChatAppearance = {
  width: 'narrow' | 'standard' | 'wide';
  size: number;
  font: 'inter' | 'serif' | 'mono';
  weight: 'regular' | 'medium';
};

export const chatAppearanceDefaults: ChatAppearance = {
  width: 'standard',
  size: 16,
  font: 'inter',
  weight: 'regular',
};

const widths = { narrow: 600, standard: 720, wide: 900 };
const fonts = {
  inter: '"Inter Variable", Inter, sans-serif',
  serif: '"Literata Variable", Georgia, serif',
  mono: 'var(--font-mono)',
};

export function parseChatAppearance(raw: string): ChatAppearance {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return chatAppearanceDefaults;
  }
  if (!isRecord(value)) return chatAppearanceDefaults;
  return {
    width: value.width === 'narrow' || value.width === 'wide' ? value.width : 'standard',
    size:
      typeof value.size === 'number' &&
      Number.isInteger(value.size) &&
      value.size >= 14 &&
      value.size <= 22
        ? value.size
        : 16,
    font: value.font === 'serif' || value.font === 'mono' ? value.font : 'inter',
    weight: value.weight === 'medium' ? 'medium' : 'regular',
  };
}

const store = createPrefStore({
  key: 'silo.chatAppearance',
  event: 'silo:chat-appearance',
  initial: chatAppearanceDefaults,
  parse: parseChatAppearance,
  serialize: JSON.stringify,
});

function update(patch: Partial<ChatAppearance>) {
  store.set(parseChatAppearance(JSON.stringify({ ...store.getSnapshot(), ...patch })));
}

function reset() {
  store.set(chatAppearanceDefaults);
}

export function useChatAppearance() {
  const prefs = usePref(store);
  const style = {
    '--chat-measure': `${widths[prefs.width]}px`,
    '--chat-size': `${prefs.size / 16}rem`,
    '--chat-font': fonts[prefs.font],
    '--chat-weight': prefs.weight === 'medium' ? 500 : 400,
  } as CSSProperties;
  return { prefs, update, reset, style };
}
