import temml from 'temml';
import { safeFetch } from '../fetch/safe-fetch.js';

const GIST_CODE_LIMIT = 200 * 1024;

/** Defuddle's fixed class-language list omits Mermaid and some newer grammars. */
export function prepareCodeLanguages(document: Document): void {
  function nearbyLanguage(pre: Element, code: Element | null): string | undefined {
    const classes = [pre.getAttribute('class'), code?.getAttribute('class')];
    let parent = pre.parentElement;
    for (let level = 0; parent && level < 3; level++, parent = parent.parentElement) {
      if (parent.matches('body, html, main, article')) break;
      classes.push(parent.getAttribute('class'));
    }
    const markers = classes.filter(Boolean).join(' ');
    const name = /(?:^|\s)(?:language-|lang-)([a-z0-9][a-z0-9+#._-]{0,23})(?=\s|$)/i.exec(
      markers,
    )?.[1];
    return name ?? (/(?:^|\s)sp-javascript(?:\s|$)/.test(markers) ? 'javascript' : undefined);
  }
  for (const pre of document.querySelectorAll('pre, div.mermaid')) {
    const code = pre.querySelector('code');
    const explicitMermaid = [pre, code].some((node) =>
      node?.matches('.mermaid, .language-mermaid, .lang-mermaid, [data-lang="mermaid"]'),
    );
    // Publisher-rendered diagrams no longer contain source. SVG icons in ordinary
    // code wrappers do not establish that a Mermaid diagram has been rendered.
    if (explicitMermaid && (pre.hasAttribute('data-processed') || pre.querySelector('svg')))
      continue;
    if (code?.hasAttribute('data-lang') && !explicitMermaid) continue;
    const name = explicitMermaid ? 'mermaid' : nearbyLanguage(pre, code);
    if (!name) continue;
    if (code) code.setAttribute('data-lang', name.toLowerCase());
    else {
      const wrapper = document.createElement('pre');
      const inner = document.createElement('code');
      inner.setAttribute('data-lang', name.toLowerCase());
      inner.textContent = pre.textContent;
      wrapper.append(inner);
      pre.replaceWith(wrapper);
    }
  }
}

/** Standalone: also injected into the publisher page before Defuddle. No network here. */
export function prepareGists(document: Document): void {
  for (const script of document.querySelectorAll('script[src]')) {
    const src = script.getAttribute('src') ?? '';
    const match =
      /^https:\/\/gist\.github\.com\/(?:([\w-]+)\/)?([a-f\d]{5,40})\.js(?:\?[^#]*)?$/i.exec(src);
    if (!match) continue;
    const url = new URL(src);
    const href = `https://gist.github.com/${match[1] ? `${match[1]}/` : ''}${match[2]}`;
    const file = url.searchParams.get('file');
    const code = document.createElement('code');
    code.setAttribute('data-lang', 'silo-gist');
    code.textContent = href + (file ? `?file=${encodeURIComponent(file)}` : '');
    const pre = document.createElement('pre');
    pre.append(code);
    // document.write can place a stylesheet between the script and its loaded embed.
    if (script.previousElementSibling?.classList.contains('gist'))
      script.previousElementSibling.remove();
    let rendered = script.nextElementSibling;
    if (rendered?.matches('link[rel="stylesheet"]')) rendered = rendered.nextElementSibling;
    if (rendered?.classList.contains('gist')) rendered.remove();
    script.replaceWith(pre);
  }
}

const gistSchemaUrl =
  /^https:\/\/gist\.github\.com\/(?:[\w-]+\/)?([a-f\d]{5,40})(?:\?file=([^#]*))?$/i;

function fallback(document: Document, href: string): HTMLParagraphElement {
  const paragraph = document.createElement('p');
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = 'View GitHub Gist';
  paragraph.append(anchor);
  return paragraph;
}

interface GistFile {
  filename: string;
  content: string;
  language?: string;
}

function parseGist(html: string): GistFile[] | undefined {
  const data: unknown = JSON.parse(html);
  if (
    !data ||
    typeof data !== 'object' ||
    !('files' in data) ||
    !data.files ||
    typeof data.files !== 'object'
  )
    return undefined;
  const files: GistFile[] = [];
  let bytes = 0;
  for (const file of Object.values(data.files)) {
    if (
      !file ||
      typeof file !== 'object' ||
      !('content' in file) ||
      typeof file.content !== 'string' ||
      !('filename' in file) ||
      typeof file.filename !== 'string' ||
      ('truncated' in file && file.truncated)
    )
      return undefined;
    bytes += Buffer.byteLength(file.content);
    if (bytes > GIST_CODE_LIMIT) return undefined;
    files.push({
      filename: file.filename,
      content: file.content,
      ...('language' in file && typeof file.language === 'string'
        ? { language: file.language }
        : {}),
    });
  }
  return files.length ? files : undefined;
}

async function fetchGist(id: string): Promise<GistFile[] | undefined> {
  try {
    const response = await safeFetch(`https://api.github.com/gists/${id}`, {
      accept: 'application/vnd.github+json',
      maxBodyBytes: 2 * 1024 * 1024,
      timeoutMs: 2_000,
    });
    return response.ok ? parseGist(response.html) : undefined;
  } catch {
    return undefined;
  }
}

function gistFigure(document: Document, file: GistFile, href: string): HTMLElement {
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  const link = document.createElement('a');
  link.href = href;
  link.textContent = file.filename;
  caption.append(link);
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  const language = file.language?.toLowerCase().replace('c++', 'cpp').replace('c#', 'csharp');
  if (language && /^[a-z0-9][a-z0-9+#._-]{0,23}$/.test(language))
    code.setAttribute('data-lang', language);
  code.textContent = file.content;
  pre.append(code);
  figure.append(caption, pre);
  return figure;
}

/** All remote expansion is bounded, uses safeFetch, and finishes before sanitization. */
async function expandGists(container: HTMLElement): Promise<void> {
  const requests = new Map<string, Promise<GistFile[] | undefined>>();
  const slots = [...container.querySelectorAll('pre > code[data-lang="silo-gist"]')];
  await Promise.all(
    slots.map(async (code, index) => {
      const href = code.textContent ?? '';
      const match = gistSchemaUrl.exec(href);
      const pre = code.parentElement;
      if (!match?.[1] || !pre) return;
      const link = fallback(container.ownerDocument, href);
      if (index >= 5) {
        pre.replaceWith(link);
        return;
      }
      const id = match[1].toLowerCase();
      if (!requests.has(id)) requests.set(id, fetchGist(id));
      const files = await requests.get(id);
      const fileName = new URL(href).searchParams.get('file');
      const selected = files?.filter((file) => !fileName || file.filename === fileName);
      pre.replaceWith(
        ...(selected?.length
          ? selected.map((file) => gistFigure(container.ownerDocument, file, href))
          : [link]),
      );
    }),
  );
}

const TEX_BODY_LIMIT = 10_000;
const TEX_DOCUMENT_LIMIT = 200 * 1024;
const TEX_ATTEMPT_LIMIT = 2_000;
interface TexBudget {
  attempts: number;
  bytes: number;
}

/** Search only a bounded window, including the closing delimiter. */
function texBody(text: string, start: number, opener: string) {
  const closer = opener === '\\(' ? '\\)' : opener === '\\[' ? '\\]' : opener;
  const bodyStart = start + opener.length;
  const window = text.slice(bodyStart, bodyStart + TEX_BODY_LIMIT + closer.length);
  const offset = window.indexOf(closer);
  if (offset < 1 || offset > TEX_BODY_LIMIT) return undefined;
  const end = bodyStart + offset + closer.length;
  const source = window.slice(0, offset);
  if (
    opener.startsWith('$') &&
    (text[start - 1] === '$' || text[bodyStart] === '$' || text[end] === '$')
  )
    return undefined;
  const signal = /\\[a-zA-Z]+|[_^]/.test(source);
  if (opener === '$' && (source.includes('\n') || source.trim() !== source || !signal))
    return undefined;
  if (opener === '$$' && source.trim() !== source && !signal) return undefined;
  return { source, end, displayMode: opener === '$$' || opener === '\\[' };
}

function convertText(node: Text, budget: TexBudget): void {
  const text = node.data;
  if (text.length > 100 * 1024 || Buffer.byteLength(text) > 100 * 1024) return;
  const fragment = node.ownerDocument.createDocumentFragment();
  const openers = /(?<!\\)(\$\$|\\\[|\\\(|\$)/g;
  let end = 0;
  let match: RegExpExecArray | null;
  while (budget.attempts < TEX_ATTEMPT_LIMIT && budget.bytes < TEX_DOCUMENT_LIMIT) {
    match = openers.exec(text);
    if (!match) break;
    budget.attempts++;
    // A rejected currency opener must not consume a later real math opener.
    openers.lastIndex = match.index + 1;
    const body = texBody(text, match.index, match[0]);
    if (!body) continue;
    const bytes = Buffer.byteLength(body.source);
    if (budget.bytes + bytes > TEX_DOCUMENT_LIMIT) {
      budget.bytes = TEX_DOCUMENT_LIMIT;
      break;
    }
    budget.bytes += bytes;
    try {
      const html = temml.renderToString(body.source, {
        displayMode: body.displayMode,
        throwOnError: true,
        trust: false,
      });
      fragment.append(text.slice(end, match.index));
      const template = node.ownerDocument.createElement('template');
      template.innerHTML = html;
      fragment.append(template.content);
      end = body.end;
      openers.lastIndex = end;
    } catch {
      /* A parse failure keeps the exact original text and consumes the budget. */
    }
  }
  if (end) {
    fragment.append(text.slice(end));
    node.replaceWith(fragment);
  }
}

export async function enrichRichBlocks(container: HTMLElement): Promise<void> {
  for (const callout of container.querySelectorAll('[data-callout]')) {
    const title = callout.querySelector(':scope > .callout-title');
    const value = callout.getAttribute('data-callout-title') ?? title?.textContent;
    if (value !== null && value !== undefined)
      callout.setAttribute('data-callout-title', value.replace(/\s+/g, ' ').trim().slice(0, 200));
    title?.remove();
  }
  await expandGists(container);
  const walker = container.ownerDocument.createTreeWalker(container, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('code, pre, kbd, samp, math')) nodes.push(node);
  }
  const budget: TexBudget = { attempts: 0, bytes: 0 };
  for (const node of nodes) {
    if (budget.attempts >= TEX_ATTEMPT_LIMIT || budget.bytes >= TEX_DOCUMENT_LIMIT) break;
    convertText(node, budget);
  }
}
