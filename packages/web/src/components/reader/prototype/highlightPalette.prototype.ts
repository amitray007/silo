/**
 * The one place the highlight palette lives. Each colour has a fixed hue; each theme sets its own
 * lightness and chroma so the colour stays on the same spectrum but reads on that background.
 * The module writes the CSS custom properties; prototype.css only reads them.
 */
export const PALETTE_ORDER = ['yellow', 'green', 'blue', 'pink', 'violet'] as const;
export type PaletteColor = (typeof PALETTE_ORDER)[number];
export type PaletteTheme = 'light' | 'dark' | 'sepia' | 'sepiaDark';

// Orange is silo's accent, so it is not in the palette.
const HUE: Record<PaletteColor, number> = {
  yellow: 98,
  green: 150,
  blue: 250,
  pink: 355,
  violet: 300,
};

type Tint = [lightness: number, chroma: number];
type ThemeSpec = {
  selector: string;
  background: [number, number, number];
  text: [number, number, number];
  tint: Record<PaletteColor, Tint>;
  /** Overlap segments keep the inner colour but at higher chroma, shifted in lightness. */
  overlapChroma: number;
  overlapLightness: number;
  edge: Tint;
};

const THEMES: Record<PaletteTheme, ThemeSpec> = {
  light: {
    selector: ':root',
    background: [0.9911, 0, 0],
    text: [0.145, 0, 0],
    tint: {
      yellow: [0.92, 0.12],
      green: [0.86, 0.12],
      blue: [0.82, 0.085],
      violet: [0.88, 0.06],
      pink: [0.82, 0.11],
    },
    overlapChroma: 0.04,
    overlapLightness: -0.04,
    edge: [0.66, 0.16],
  },
  dark: {
    selector: ':root[data-theme="dark"]',
    background: [0.145, 0, 0],
    text: [0.97, 0, 0],
    tint: {
      yellow: [0.46, 0.09],
      green: [0.38, 0.1],
      blue: [0.38, 0.1],
      violet: [0.45, 0.1],
      pink: [0.38, 0.1],
    },
    overlapChroma: 0.04,
    overlapLightness: 0.06,
    edge: [0.72, 0.15],
  },
  sepia: {
    selector: '.silo-readerpane[data-proto-theme="sepia"]',
    background: [0.955, 0.025, 85],
    text: [0.24, 0.03, 60],
    tint: {
      yellow: [0.9, 0.11],
      green: [0.83, 0.11],
      blue: [0.79, 0.1],
      violet: [0.86, 0.065],
      pink: [0.79, 0.11],
    },
    overlapChroma: 0.04,
    overlapLightness: -0.04,
    edge: [0.64, 0.15],
  },
  sepiaDark: {
    selector: ':root[data-theme="dark"] .silo-readerpane[data-proto-theme="sepia"]',
    background: [0.22, 0.015, 70],
    text: [0.92, 0.03, 80],
    tint: {
      yellow: [0.44, 0.085],
      green: [0.38, 0.1],
      blue: [0.38, 0.1],
      violet: [0.43, 0.1],
      pink: [0.38, 0.1],
    },
    overlapChroma: 0.04,
    overlapLightness: 0.06,
    edge: [0.72, 0.14],
  },
};

// ---- colour maths (OKLCH -> OKLab -> linear sRGB) ----
type Lab = [number, number, number];
const toLab = (L: number, C: number, h: number): Lab => [
  L,
  C * Math.cos((h * Math.PI) / 180),
  C * Math.sin((h * Math.PI) / 180),
];
function toLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(a: number[], b: number[]): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const deltaE = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** The largest chroma at or below `cap` that still fits in sRGB. */
function clampChroma(L: number, C: number, hue: number): number {
  let c = C;
  while (c > 0.01 && !inGamut(toLinear(toLab(L, c, hue)))) c -= 0.005;
  return Math.round(c * 1000) / 1000;
}
const css = (L: number, C: number, hue: number) =>
  `oklch(${Math.round(L * 1000) / 10}% ${clampChroma(L, C, hue)} ${hue})`;

function themeVariables(spec: ThemeSpec): string {
  const [tl, tc, th] = spec.text;
  const lines = [`--hl-text: oklch(${Math.round(tl * 1000) / 10}% ${tc} ${th});`];
  for (const name of PALETTE_ORDER) {
    const hue = HUE[name];
    const [L, C] = spec.tint[name];
    lines.push(`--hl-${name}: ${css(L, C, hue)};`);
    lines.push(`--hl-${name}-ov: ${css(L + spec.overlapLightness, C + spec.overlapChroma, hue)};`);
    lines.push(`--hl-${name}-edge: ${css(spec.edge[0], spec.edge[1], hue)};`);
  }
  return lines.join('\n  ');
}

/** Write the per-theme custom properties once. Switching theme recolours everything live. */
export function installPalette(): void {
  if (typeof document === 'undefined' || document.getElementById('proto-palette')) return;
  const style = document.createElement('style');
  style.id = 'proto-palette';
  style.textContent = (Object.values(THEMES) as ThemeSpec[])
    .map((spec) => `${spec.selector} {\n  ${themeVariables(spec)}\n}`)
    .join('\n');
  document.head.append(style);
}

/** Contrast and distinctness of the rendered tints, for each theme. */
export function paletteReport() {
  return (Object.entries(THEMES) as [PaletteTheme, ThemeSpec][]).map(([theme, spec]) => {
    const text = toLinear(toLab(...spec.text));
    const labs = {} as Record<PaletteColor, Lab>;
    const overlap = {} as Record<PaletteColor, Lab>;
    const rows = PALETTE_ORDER.map((name) => {
      const hue = HUE[name];
      const [L, C] = spec.tint[name];
      const c = clampChroma(L, C, hue);
      const oL = L + spec.overlapLightness;
      const oC = clampChroma(oL, C + spec.overlapChroma, hue);
      labs[name] = toLab(L, c, hue);
      overlap[name] = toLab(oL, oC, hue);
      return {
        color: name,
        tint: `oklch(${L} ${c} ${hue})`,
        overlap: `oklch(${Math.round(oL * 1000) / 1000} ${oC} ${hue})`,
        contrast: Number(contrast(text, toLinear(labs[name])).toFixed(2)),
        overlapContrast: Number(contrast(text, toLinear(overlap[name])).toFixed(2)),
      };
    });
    const min = (set: Record<PaletteColor, Lab>) => {
      let best = 9;
      for (let i = 0; i < PALETTE_ORDER.length; i += 1)
        for (let j = i + 1; j < PALETTE_ORDER.length; j += 1)
          best = Math.min(
            best,
            deltaE(set[PALETTE_ORDER[i] as PaletteColor], set[PALETTE_ORDER[j] as PaletteColor]),
          );
      return Number(best.toFixed(3));
    };
    return { theme, rows, minDeltaE: min(labs), minDeltaEOverlap: min(overlap) };
  });
}

installPalette();
