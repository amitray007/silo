import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addViewScrollScript, VIEW_SCROLL_SCRIPT, VIEW_SCROLL_SCRIPT_HASH } from './view-scroll.js';

describe('view scroll reporter', () => {
  it('pins the CSP hash to the exact script text', () => {
    const digest = createHash('sha256').update(VIEW_SCROLL_SCRIPT).digest('base64');
    expect(VIEW_SCROLL_SCRIPT_HASH).toBe(`sha256-${digest}`);
  });

  it('appends the script after the document, out of reach of page attributes', () => {
    const tag = `<script data-silo-view-scroll>${VIEW_SCROLL_SCRIPT}</script>`;
    const page = '<!doctype html>\n<html lang="x</head>"><head></head><body></body></html>';
    expect(addViewScrollScript(page)).toBe(`${page}${tag}`);
  });
});
