/** Only inspect a bounded prologue; never parse or re-encode the SVG body. */
const ROOT_SCAN_BYTES = 4096;

/** Find a markup terminator, respecting quotes and a doctype's internal subset. */
function markupEnd(text: string, start: number): number {
  let quote = '';
  let brackets = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    switch (char) {
      case '"':
      case "'":
        quote = char;
        break;
      case '[':
        brackets++;
        break;
      case ']':
        brackets--;
        break;
      case '>':
        if (brackets === 0) return index;
        break;
    }
  }
  return -1;
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/u.test(text[index] ?? '')) index++;
  return index;
}

function rootStart(text: string): number {
  let index = 0;
  while (index < text.length) {
    // Anchored, single-character class: linear in the bounded prefix.
    index = skipWhitespace(text, index);
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end < 0) return -1;
      index = end + 3;
      continue;
    }
    if (text.startsWith('<?xml', index) || text.startsWith('<!DOCTYPE', index)) {
      const end = markupEnd(text, index + 2);
      if (end < 0) return -1;
      index = end + 1;
    } else return index;
  }
  return -1;
}

function viewBoxSize(attributes: string): [number, number] | undefined {
  // Sticky tokens consume each attribute once. Disjoint quoted alternatives and
  // negated character classes cannot backtrack across attributes (linear time).
  const attribute = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
  let viewBox: string | undefined;
  let consumed = 0;
  let match = attribute.exec(attributes);
  while (match) {
    consumed = attribute.lastIndex;
    const name = match[1]?.toLowerCase();
    if (name === 'width' || name === 'height') return undefined;
    if (name === 'viewbox') viewBox = match[2] ?? match[3];
    match = attribute.exec(attributes);
  }
  // Reject unparsed/malformed attributes rather than risk adding duplicate sizes.
  if (!/^\s*\/?$/.test(attributes.slice(consumed))) return undefined;
  if (viewBox === undefined) return undefined;
  if (/,\s*,|^\s*,|,\s*$/.test(viewBox)) return undefined;
  const values = viewBox.trim().split(/[\s,]+/u);
  // Anchored numeric grammar: each repetition consumes a disjoint number part.
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (values.length !== 4 || values.some((value) => !number.test(value))) return undefined;
  const [x, y, width, height] = values.map(Number);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined;
  const scale = Math.min(1, 4000 / Math.max(width, height));
  const clamp = (value: number) => Math.max(1, Math.round(value * scale));
  return [clamp(width), clamp(height)];
}

/** Give dimensionless Reader SVGs their viewBox size; leave all other bytes intact. */
export function sizeReaderSvg(bytes: Uint8Array): Uint8Array {
  let prefix: string;
  try {
    // Streaming leaves only a boundary-cut character buffered; invalid UTF-8 still throws.
    prefix = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(
      bytes.subarray(0, ROOT_SCAN_BYTES),
      { stream: bytes.length > ROOT_SCAN_BYTES },
    );
  } catch {
    return bytes;
  }
  const start = rootStart(prefix);
  if (start < 0 || !prefix.startsWith('<svg', start)) return bytes;
  const end = markupEnd(prefix, start + 4);
  if (end < 0) return bytes;
  const attributes = prefix.slice(start + 4, end);
  const size = viewBoxSize(attributes);
  if (!size) return bytes;
  const encoder = new TextEncoder();
  const offset = encoder.encode(prefix.slice(0, start + 4)).length;
  const insertion = encoder.encode(` width="${size[0]}" height="${size[1]}"`);
  const sized = new Uint8Array(bytes.length + insertion.length);
  sized.set(bytes.subarray(0, offset));
  sized.set(insertion, offset);
  sized.set(bytes.subarray(offset), offset + insertion.length);
  return sized;
}
