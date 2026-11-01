import { proseTextNodes } from '../pencil/lines';

/** One word in the same prose stream used by the Pencil and Listen. */
export function articleWords(prose: HTMLElement): Range[] {
  const words: Range[] = [];
  for (const node of proseTextNodes(prose)) {
    for (const match of node.data.matchAll(/\S+/gu)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      words.push(range);
    }
  }
  return words;
}

/** The word holding a share, clamped at either end of the article. */
export function wordAtShare(words: readonly Range[], share: number): Range | undefined {
  return words[Math.min(words.length - 1, Math.max(0, Math.floor((share + 4e-8) * words.length)))];
}

/** Share before the word that starts at or contains a DOM point. */
export function shareAtPoint(words: readonly Range[], node: Node, offset: number): number {
  const index = words.findIndex((word) => word.comparePoint(node, offset) <= 0);
  return index < 0 ? 1 : index / words.length;
}

export function shareAtBlock(words: readonly Range[], block: Element): number {
  const index = words.findIndex((word) => block.contains(word.startContainer));
  return index < 0 ? 0 : index / words.length;
}
