import { parseHTML } from 'linkedom';

/** Count article text after sanitization, without navigation or stylesheet text. */
export function pageTextLength(html: string): number {
  const { document } = parseHTML(html);
  for (const element of document.querySelectorAll('nav,header,footer,aside,script,style,template'))
    element.remove();
  const root = document.querySelector('body') ?? document.documentElement;
  return (root?.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}
