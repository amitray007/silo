/** Longest side of the offscreen canvas an icon is sampled on; keeps thin strokes from fading out. */
const MAX_SAMPLE_SIDE = 64;
/** At or above this alpha-weighted coverage an icon is a near-opaque tile that carries its own background. */
const MAX_COVERAGE = 0.9;
/** Mean relative luminance (sRGB-linearized, alpha-weighted) below which art is too dark for the dark surface (about 1.4:1). */
const MAX_DARK_LUMINANCE = 0.05;

const toneByHost = new Map<string, boolean>();

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * True for dark artwork on a mostly transparent background, which vanishes on
 * a dark UI. Takes an RGBA buffer (4 bytes per pixel); alpha is used as a
 * weight, never binarized.
 */
export function isDarkOnTransparent(rgba: Uint8ClampedArray): boolean {
  const total = Math.floor(rgba.length / 4);
  if (total === 0) return false;
  let coverage = 0;
  let weighted = 0;
  for (let i = 0; i < total * 4; i += 4) {
    const a = (rgba[i + 3] ?? 0) / 255;
    if (a === 0) continue;
    coverage += a;
    weighted +=
      a *
      (0.2126 * linear(rgba[i] ?? 0) +
        0.7152 * linear(rgba[i + 1] ?? 0) +
        0.0722 * linear(rgba[i + 2] ?? 0));
  }
  if (coverage === 0) return false;
  return coverage / total < MAX_COVERAGE && weighted / coverage < MAX_DARK_LUMINANCE;
}

/** Measures a loaded favicon once per host; false whenever the pixels cannot be read. */
export function measureFaviconDark(host: string, img: HTMLImageElement): boolean {
  const cached = toneByHost.get(host);
  if (cached !== undefined) return cached;
  let dark = false;
  try {
    const { naturalWidth: w, naturalHeight: h } = img;
    if (w > 0 && h > 0) {
      const scale = Math.min(1, MAX_SAMPLE_SIDE / Math.max(w, h));
      const width = Math.max(1, Math.round(w * scale));
      const height = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        dark = isDarkOnTransparent(ctx.getImageData(0, 0, width, height).data);
      }
    }
  } catch {
    dark = false;
  }
  toneByHost.set(host, dark);
  return dark;
}
