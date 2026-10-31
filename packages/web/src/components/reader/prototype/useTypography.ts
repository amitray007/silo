import { useEffect, useState } from 'react';

export type FontChoice = 'inter' | 'serif' | 'mono';
export type LineHeight = 'compact' | 'normal' | 'relaxed';
export type ReaderTheme = 'app' | 'sepia';

export type Typography = {
  font: FontChoice;
  size: number;
  lineHeight: LineHeight;
  theme: ReaderTheme;
};

export const FONT_STACKS: Record<FontChoice, string> = {
  inter: '"Inter Variable", Inter, sans-serif',
  serif: '"Literata Variable", Georgia, serif',
  mono: 'var(--font-mono)',
};
const LINE_HEIGHTS: Record<LineHeight, number> = { compact: 1.5, normal: 1.75, relaxed: 2 };
export const MIN_SIZE = 14;
export const MAX_SIZE = 24;

export function useTypography(prose: HTMLElement | null, panel: HTMLElement | null) {
  const [typography, setTypography] = useState<Typography>({
    font: 'inter',
    size: 16,
    lineHeight: 'normal',
    theme: 'app',
  });

  useEffect(() => {
    if (!prose) return;
    prose.dataset.protoType = '';
    prose.style.setProperty('--proto-font', FONT_STACKS[typography.font]);
    prose.style.setProperty('--proto-size', `${typography.size}px`);
    prose.style.setProperty('--proto-lh', String(LINE_HEIGHTS[typography.lineHeight]));
    return () => {
      delete prose.dataset.protoType;
      prose.style.removeProperty('--proto-font');
      prose.style.removeProperty('--proto-size');
      prose.style.removeProperty('--proto-lh');
    };
  }, [prose, typography]);

  useEffect(() => {
    if (!panel) return;
    if (typography.theme === 'sepia') panel.dataset.protoTheme = 'sepia';
    else delete panel.dataset.protoTheme;
    return () => {
      delete panel.dataset.protoTheme;
    };
  }, [panel, typography.theme]);

  const update = (patch: Partial<Typography>) =>
    setTypography((current) => ({ ...current, ...patch }));
  const step = (delta: number) =>
    update({ size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, typography.size + delta)) });
  return { typography, update, step };
}

export type TypographyApi = ReturnType<typeof useTypography>;
