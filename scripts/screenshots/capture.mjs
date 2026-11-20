/**
 * Captures the README screenshot suite from a running, seeded silo with
 * Playwright. Each shot is 1440x900 at device scale 2 (2880x1800 PNG).
 *
 *   BASE_URL=http://127.0.0.1:8788 OUT_DIR=./shots MANIFEST=shots-manifest.json \
 *     node scripts/screenshots/capture.mjs
 *
 * Theme: silo reads the server setting first, so each shot PATCHes it and
 * sets the emulated color scheme. Set CHROME_PATH to use a system Chrome.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8788';
const OUT_DIR = process.env.OUT_DIR ?? 'docs/design/app/shots';
const manifest = JSON.parse(readFileSync(process.env.MANIFEST ?? 'shots-manifest.json', 'utf8'));

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

async function setTheme(theme) {
  await fetch(`${BASE_URL}/api/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Silo-CSRF': '1' },
    body: JSON.stringify({ theme }),
  });
  await page.emulateMedia({ colorScheme: theme });
}

async function open(route, theme) {
  await setTheme(theme);
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'load' });
  // Embeds such as YouTube keep the network busy, so idle is best effort.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function shoot(file) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, file) });
  console.log(`[capture] -> ${file}`);
}

/** Scrolls the reader so the paragraph holding `text` sits a third of the way down. */
async function scrollToText(text) {
  await page
    .getByText(text, { exact: false })
    .first()
    .evaluate((el) => {
      el.scrollIntoView({ block: 'start' });
      const scroller = el.closest('[class*="scroll"], main') ?? document.scrollingElement;
      scroller.scrollBy(0, -260);
    })
    .catch(() => {});
  await page.waitForTimeout(600);
}

/** Opens the reader dock's Ask sheet, which reopens the article's newest chat. */
async function openAsk() {
  await page
    .locator('[aria-label="Reader tools"] button', { hasText: 'Ask' })
    .first()
    .click()
    .catch(() => console.warn('[capture] Ask button not found'));
  await page.waitForTimeout(1500);
}

const reader = manifest.heroLinkId ? `/tags/agents?link=${manifest.heroLinkId}` : null;
const { localFirst, transformer } = manifest.shotLinkIds ?? {};

if (reader) {
  await open(reader, 'dark');
  await scrollToText('The basic building block');
  await shoot('01-reader-dark.png');
  await open(reader, 'light');
  await openAsk();
  await shoot('02-reader-ask-light.png');
}

await open(transformer ? `/?link=${transformer}` : '/', 'light');
if (transformer) await scrollToText('A High-Level Look');
await shoot('03-library-light.png');
await open(localFirst ? `/?link=${localFirst}` : '/', 'dark');
await shoot('04-library-dark.png');

if (manifest.heroChatId) {
  await open(`/librarian?chat=${manifest.heroChatId}`, 'dark');
  await shoot('05-librarian.png');
}

if (manifest.feedId) {
  await open(`/feeds/${manifest.feedId}`, 'light');
  const postId = await page
    .locator('[data-link-id]')
    .first()
    .getAttribute('data-link-id')
    .catch(() => null);
  if (postId) await open(`/feeds/${manifest.feedId}?link=${postId}`, 'light');
  await shoot('06-feed.png');
}

await open('/', 'dark');
await page.keyboard.press('Control+k');
await page.waitForTimeout(400);
await page.keyboard.type('agents', { delay: 40 });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT_DIR, '07-command-palette.png') });
console.log('[capture] -> 07-command-palette.png');
await page.keyboard.press('Escape');

await browser.close();
