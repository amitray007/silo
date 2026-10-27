import type { SourceData } from '@silo/core';
import type { JSDOM } from 'jsdom';
import { z } from 'zod';
import { sanitizeReaderContent } from './reader-content.js';

const playerSchema = z.object({
  videoDetails: z.object({
    videoId: z.string().regex(/^[\w-]{11}$/),
    title: z.string().optional(),
    shortDescription: z.string().max(1_000_000).optional(),
    author: z.string().max(256).optional(),
    lengthSeconds: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(100_000_000)
      .optional()
      .catch(undefined),
    viewCount: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional()
      .catch(undefined),
    keywords: z.array(z.string().max(500)).max(100).optional().catch(undefined),
  }),
  microformat: z
    .object({
      playerMicroformatRenderer: z
        .object({
          publishDate: z.string().max(64).optional(),
          uploadDate: z.string().max(64).optional(),
          ownerChannelName: z.string().max(256).optional(),
          description: z.object({ simpleText: z.string().max(1_000_000) }).optional(),
        })
        .optional(),
    })
    .optional(),
});

/** Read one balanced JSON object. Never evaluate publisher JavaScript. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function playerJson(html: string): unknown {
  const assignment =
    /(?:var\s+ytInitialPlayerResponse|(?:window\s*\[\s*["']ytInitialPlayerResponse["']\s*\])|ytInitialPlayerResponse)\s*=\s*(\{)/g.exec(
      html,
    );
  if (!assignment) return undefined;
  const start = assignment.index + assignment[0].length - 1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) {
      return parseJson(html.slice(start, i + 1));
    }
  }
  return undefined;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function descriptionHtml(text: string, videoId: string): string {
  return text
    .split(/\n\s*\n/)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .split(/(https?:\/\/[^\s<>]+|\b(?:\d+:)?\d{1,2}:\d{2}\b)/g)
          .map((part) => {
            if (/^https?:\/\//.test(part))
              return `<a href="${escapeHtml(part)}">${escapeHtml(part)}</a>`;
            if (/^(?:\d+:)?\d{1,2}:\d{2}$/.test(part)) {
              const seconds = part
                .split(':')
                .reduce((total, value) => total * 60 + Number(value), 0);
              return `<a href="https://www.youtube.com/watch?v=${videoId}&amp;t=${seconds}s">${part}</a>`;
            }
            return escapeHtml(part).replaceAll('\n', '<br>');
          })
          .join('')}</p>`,
    )
    .join('');
}

export function extractYouTubeWatch(html: string, url: string, dom?: JSDOM) {
  if (!/^https?:\/\/(?:www\.|m\.)?youtube\.com\//i.test(url)) return undefined;
  const parsed = playerSchema.safeParse(playerJson(html));
  if (!parsed.success) return undefined;
  const details = parsed.data.videoDetails;
  const micro = parsed.data.microformat?.playerMicroformatRenderer;
  const text = details.shortDescription ?? micro?.description?.simpleText;
  const channel = details.author ?? micro?.ownerChannelName;
  const publishedAt = micro?.publishDate ?? micro?.uploadDate;
  const sourceData: Extract<SourceData, { kind: 'youtube' }> | undefined = channel
    ? {
        kind: 'youtube',
        videoId: details.videoId,
        channel,
        thumbnailUrl: `https://img.youtube.com/vi/${details.videoId}/hqdefault.jpg`,
        ...(details.lengthSeconds !== undefined ? { duration: details.lengthSeconds } : {}),
        ...(details.viewCount !== undefined ? { views: details.viewCount } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        ...(details.keywords ? { keywords: details.keywords } : {}),
      }
    : undefined;
  const reader = text
    ? sanitizeReaderContent(descriptionHtml(text, details.videoId), url, dom)
    : undefined;
  return { text, reader, sourceData, title: details.title };
}
