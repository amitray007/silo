import { readFileSync } from 'node:fs';
import * as defuddle from 'defuddle/node';
import { describe, expect, it, vi } from 'vitest';
import { extractPageContent } from './reader-page.js';

describe('static Defuddle extraction', () => {
  it('keeps publisher scripts inert and does not fetch resources or async content', async () => {
    const network = vi.fn(() => {
      throw new Error('unexpected network');
    });
    vi.stubGlobal('fetch', network);
    try {
      const result = await extractPageContent(
        '<script>document.querySelector("p").textContent="executed"; fetch("https://evil.test/")</script><link rel="stylesheet" href="https://evil.test/style.css"><article><p>Original article.</p><img src="https://images.example.org/photo.jpg"></article>',
        'https://journal.example.org/article',
      );
      expect(result.text).toContain('Original article.');
      expect(result.text).not.toContain('executed');
      expect(result.reader?.contentImages).toEqual(['https://images.example.org/photo.jpg']);
      const shell = await extractPageContent(
        '<div id="root"></div>',
        'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      );
      expect(shell.reader?.contentHtml).toBe(
        '<figure data-silo-embed=""><a href="https://www.youtube.com/embed/jNQXAC9IVRw" target="_blank" rel="noopener noreferrer">www.youtube.com</a></figure>',
      );
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('rescues search text after severe pruning without publishing generic body HTML', async () => {
  const original = defuddle.Defuddle;
  const parse = vi.spyOn(defuddle, 'Defuddle').mockImplementation(async (...args) => ({
    ...(await original(...args)),
    content: '<p>Small captured fragment.</p>',
  }));
  const body = 'The article explains how to build and maintain useful software. '.repeat(30).trim();
  try {
    const result = await extractPageContent(
      `<header>Site menu</header><main><p>${body}</p></main><footer>Footer links</footer>`,
      'https://journal.example.org/article',
    );
    expect(result.text).toBe(body);
    expect(result.text).not.toMatch(/Site menu|Footer links/);
    expect(result.reader?.contentHtml).toBe('<p>Small captured fragment.</p>');
    const short = await extractPageContent(
      `<nav>${body}</nav><main><p>Short original note.</p></main>`,
      'https://journal.example.org/note',
    );
    expect(short.text).toBe('Small captured fragment.');
  } finally {
    parse.mockRestore();
  }
});

it('extracts the fidelity fixture with searchable math, an embed, open details and image sizes', async () => {
  const html = readFileSync(
    new URL('./__fixtures__/reader-fidelity.html', import.meta.url),
    'utf8',
  );
  const result = await extractPageContent(html, 'https://journal.example.org/fidelity');
  expect(result.text).toContain('A useful equation is x = 7.');
  expect(result.reader?.contentImages).toEqual(['https://images.example.org/diagram.png']);
  expect(result.reader?.contentHtml).toBe(
    '<article><p>A useful equation is <math display="inline"><mrow><mi>x</mi> <mo>=</mo> <mn>7</mn></mrow></math>. This article keeps formulas and illustrations together for readers.</p><figure data-silo-embed=""><a href="https://www.youtube.com/embed/jNQXAC9IVRw" target="_blank" rel="noopener noreferrer">www.youtube.com</a></figure> <details open=""><summary>Explanation</summary> <p>This explanation keeps the mathematical reasoning visible to the reader. This explanation keeps the mathematical reasoning visible to the reader. This explanation keeps the mathematical reasoning visible to the reader. This explanation keeps the mathematical reasoning visible to the reader. This explanation keeps the mathematical reasoning visible to the reader. </p></details><img src="https://images.example.org/diagram.png" alt="Diagram" width="320" height="180"> <p>The conclusion keeps the article complete and describes the diagram above.</p></article>',
  );
});
