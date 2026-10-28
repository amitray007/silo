import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { languages, supportedLanguage } from './codeLanguages';

const theme = createCssVariablesTheme({ name: 'silo', variablePrefix: '--silo-code-' });
let highlighter: ReturnType<typeof createHighlighterCore> | undefined;

export async function highlightCode(code: HTMLElement, active: () => boolean): Promise<void> {
  const name = code.dataset.lang ?? '';
  const language = supportedLanguage(name);
  if (!language) return;
  // Large or adversarial blocks remain readable without tying up the main thread.
  const source = code.textContent ?? '';
  if (source.length > 200_000) return;
  highlighter ??= createHighlighterCore({
    themes: [theme],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).catch((error: unknown) => {
    highlighter = undefined;
    throw error;
  });
  const engine = await highlighter;
  if (!active()) return;
  const grammar = languages[language];
  await engine.loadLanguage(await grammar());
  if (!active()) return;
  const { tokens } = engine.codeToTokens(source, { lang: language, theme: 'silo' });
  const fragment = document.createDocumentFragment();
  tokens.forEach((line, index) => {
    if (index) fragment.append('\n');
    for (const token of line) {
      const span = document.createElement('span');
      span.textContent = token.content;
      // Only variables from our own theme can become styles. Page HTML is never reused.
      if (token.color && /^var\(--silo-code-[\w-]+\)$/.test(token.color))
        span.style.color = token.color;
      fragment.append(span);
    }
  });
  code.replaceChildren(fragment);
  code.dataset.highlighted = 'true';
}
