import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collapseWhitespace } from './highlight-text.js';

/**
 * The web reader and the server must collapse text the same way, or a quote taken in one is not
 * found in the other. Both run this fixture: the web copy lives next to its text map, and this
 * test checks the two copies are the same file.
 */
const here = resolve(process.cwd(), 'src/links/normalise.fixture.json');
const webCopy = resolve(
  process.cwd(),
  '../web/src/components/reader/highlights/normalise.fixture.json',
);

describe('highlight text normaliser', () => {
  it('keeps one fixture for web and server', () => {
    expect(readFileSync(here, 'utf8')).toBe(readFileSync(webCopy, 'utf8'));
  });

  const cases = JSON.parse(readFileSync(here, 'utf8')) as Array<{
    name: string;
    text: string;
    expected: string;
  }>;
  it.each(cases)('$name', ({ text, expected }) => {
    expect(collapseWhitespace(text)).toBe(expected);
  });
});
