import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectionBar } from './SelectionBar';
import type { PendingSelection } from './useSelectionWatcher';

let prose: HTMLElement;
let pending: PendingSelection;

beforeEach(() => {
  document.body.innerHTML =
    '<div id="prose"><p>First paragraph.</p><p>The second paragraph holds the quote.</p></div><div id="pane"></div>';
  prose = document.getElementById('prose') as HTMLElement;
  const text = prose.querySelectorAll('p')[1]?.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 4);
  range.setEnd(text, 20);
  pending = {
    start: 20,
    end: 36,
    range,
    rect: { left: 300, top: 200, width: 100, height: 20, bottom: 220, right: 400 } as DOMRect,
  };
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => vi.restoreAllMocks());

function setup(overrides: Partial<Parameters<typeof SelectionBar>[0]> = {}) {
  const props = {
    pending,
    prose,
    container: document.getElementById('pane') as HTMLElement,
    title: 'An Article',
    color: 'blue' as const,
    blocked: new Set<'yellow' | 'green' | 'blue' | 'pink' | 'violet'>(),
    onHighlight: vi.fn(),
    onPick: vi.fn(),
    onNote: vi.fn(),
    onDismiss: vi.fn(),
    onSearch: vi.fn(),
    onListen: vi.fn(),
    unavailable: new Map<string, string>(),
    ...overrides,
  };
  const rendered = render(
    <QueryClientProvider client={new QueryClient()}>
      <SelectionBar {...props} />
    </QueryClientProvider>,
  );
  return Object.assign(props, { rendered });
}

it('renders nothing without a selection', () => {
  setup({ pending: null });
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it('shows Highlight with the current colour dot, Note and More', () => {
  setup();
  const toolbar = screen.getByRole('toolbar', { name: 'Selection' });
  expect(toolbar.querySelector('.silo-sb-icon')?.getAttribute('data-color')).toBe('blue');
  expect(screen.getByRole('button', { name: /Highlight/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Note/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
});

it('applies the current colour when Highlight is clicked', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: /Highlight/ }));
  expect(props.onHighlight).toHaveBeenCalledWith('blue');
});

it('opens the colour picker on ArrowUp and a swatch applies its colour', () => {
  const props = setup();
  const button = screen.getByRole('button', { name: /Highlight/ });
  fireEvent.keyDown(button, { key: 'ArrowUp' });
  const group = screen.getByRole('group', { name: 'Highlight colour' });
  fireEvent.click(group.querySelector('[aria-label="pink"]') as Element);
  expect(props.onPick).toHaveBeenCalledWith('pink');
  expect(props.onHighlight).not.toHaveBeenCalled();
});

it('moves between swatches with the arrow keys', () => {
  setup();
  fireEvent.keyDown(screen.getByRole('button', { name: /Highlight/ }), { key: 'ArrowUp' });
  const swatches = screen.getByRole('group', { name: 'Highlight colour' });
  const buttons = swatches.querySelectorAll('button');
  (buttons[0] as HTMLElement).focus();
  fireEvent.keyDown(swatches, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(swatches, { key: 'ArrowLeft' });
  fireEvent.keyDown(swatches, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(buttons[buttons.length - 1]);
});

it('Note asks for a note highlight', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: /Note/ }));
  expect(props.onNote).toHaveBeenCalled();
});

it('More lists Copy quote, Copy text and Search silo with a muted line each', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  const items = screen.getAllByRole('menuitem');
  expect(items.map((item) => item.querySelector('strong')?.textContent)).toEqual([
    'Copy quote',
    'Copy text',
    'Search silo',
  ]);
  for (const item of items) expect(item.querySelector('small')?.textContent).toBeTruthy();
});

it('Copy quote writes "text" - Title, ¶n with no link', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Copy quote/ }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('"second paragraph" - An Article, ¶2');
  expect(props.onDismiss).toHaveBeenCalled();
});

it('Copy text writes the plain text', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Copy text/ }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('second paragraph');
});

it('Search silo hands the phrase to the palette, trimmed to 120 characters', () => {
  const long = document.createElement('p');
  long.textContent = 'word '.repeat(60);
  prose.append(long);
  const range = document.createRange();
  range.selectNodeContents(long);
  const onSearch = vi.fn();
  setup({ pending: { ...pending, range }, onSearch });
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Search silo/ }));
  expect(onSearch).toHaveBeenCalledTimes(1);
  expect((onSearch.mock.calls[0]?.[0] as string).length).toBe(120);
});

it('turns off colours used by overlapping highlights in the picker', () => {
  const props = setup({ blocked: new Set(['green', 'pink']) });
  fireEvent.keyDown(screen.getByRole('button', { name: /Highlight/ }), { key: 'ArrowUp' });
  const group = screen.getByRole('group', { name: 'Highlight colour' });
  const dot = (name: string) => group.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;
  expect(dot('green').disabled).toBe(true);
  expect(dot('green').title).toBe('Used by an overlapping highlight');
  expect(dot('blue').disabled).toBe(false);
  fireEvent.click(dot('green'));
  expect(props.onPick).not.toHaveBeenCalled();
});

it('Escape closes the colour picker first, then the menu, then the bar', () => {
  const props = setup();
  fireEvent.keyDown(screen.getByRole('button', { name: /Highlight/ }), { key: 'ArrowUp' });
  expect(screen.getByRole('group', { name: 'Highlight colour' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Highlight colour' })).toBeNull();
  expect(props.onDismiss).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(props.onDismiss).toHaveBeenCalledTimes(1);
});

it('Escape closes the menu first, then dismisses the toolbar', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(props.onDismiss).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(props.onDismiss).toHaveBeenCalled();
});

it('Tab from the selection moves focus into the toolbar', () => {
  setup();
  fireEvent.keyDown(window, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Highlight/ }));
});

it('flips below a selection near the top of the window', () => {
  setup({ pending: { ...pending, rect: { ...pending.rect, top: 20, bottom: 40 } as DOMRect } });
  expect(screen.getByRole('toolbar').getAttribute('data-flip')).toBe('true');
});

it('runs Listen from here and then dismisses the selection', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: /Listen from here/ }));
  expect(props.onListen).toHaveBeenCalledTimes(1);
  expect(props.onDismiss).toHaveBeenCalled();
});

it('keeps Listen from here, dimmed with the reason, when the article cannot be read aloud', () => {
  const props = setup({ unavailable: new Map([['listen', 'Listen reads English articles only']]) });
  const listen = screen.getByRole('button', { name: /Listen from here/ });
  expect(listen.getAttribute('aria-disabled')).toBe('true');
  expect(listen.getAttribute('title')).toBe('Listen reads English articles only');
  fireEvent.click(listen);
  expect(props.onListen).not.toHaveBeenCalled();
  expect(props.onDismiss).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Highlight/ })).toBeTruthy();
});

it('keeps labels without readiness and uses icon actions with Ask when ready', () => {
  setup({ askReady: true, linkId: 'article' });
  expect(screen.getByRole('button', { name: 'Highlight' }).textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(screen.getByRole('button', { name: 'Explain' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Simplify' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Counterpoint' })).toBeTruthy();
  window.getSelection()?.removeAllRanges();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
  expect(window.getSelection()?.toString()).toBe('second paragraph');
});
it('grows the same surface into the composer, focuses the field, and Escape shrinks it back', () => {
  setup({ askReady: true, linkId: 'article' });
  const surface = screen.getByRole('toolbar', { name: 'Selection' });
  expect(surface.getAttribute('data-phase')).toBe('bar');
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(screen.getByRole('toolbar', { name: 'Selection' })).toBe(surface);
  expect(surface.getAttribute('data-phase')).toBe('composer');
  expect(document.activeElement).toBe(
    screen.getByRole('textbox', { name: 'Ask about this passage' }),
  );
  const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Why?' } });
  expect(send.disabled).toBe(false);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('toolbar', { name: 'Selection' })).toBe(surface);
  expect(surface.getAttribute('data-phase')).toBe('bar');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask' }));
});

it('sends the question to the dock on Enter, and keeps Shift+Enter for a new line', () => {
  const { onDismiss } = setup({ askReady: true, linkId: 'enter-test' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  const field = screen.getByRole('textbox');
  fireEvent.change(field, { target: { value: 'Why?' } });
  fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(onDismiss).toHaveBeenCalled();
});

it('recedes the reader pane while the composer is open, and only when the passage can stay sharp', () => {
  document.getElementById('pane')?.remove();
  document.body.insertAdjacentHTML(
    'beforeend',
    '<section class="silo-readerpane"><div id="pane"></div></section>',
  );
  const pane = document.querySelector('.silo-readerpane') as HTMLElement;
  setup({ askReady: true, linkId: 'recede-test' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(pane.hasAttribute('data-recede')).toBe(false);
  fireEvent.keyDown(document, { key: 'Escape' });
  vi.stubGlobal('Highlight', class {});
  vi.stubGlobal('CSS', { highlights: new Map() });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(pane.getAttribute('data-recede')).toBe('passage');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(pane.hasAttribute('data-recede')).toBe(false);
  vi.unstubAllGlobals();
});

it('offers word actions for a single short word', () => {
  pending.range.setEnd(pending.range.startContainer, 10);
  setup({ askReady: true, linkId: 'article' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(screen.getByRole('button', { name: 'Define' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'In context' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Related' })).toBeTruthy();
});

it('streams a quick answer, saves its text as a note, and imports only the text turn', async () => {
  const { waitFor } = await import('@testing-library/react');
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.endsWith('/quick')) {
      const chunks = [
        { type: 'start', messageId: 'answer' },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Plain answer.' },
        { type: 'text-end', id: 't' },
        { type: 'finish' },
      ];
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } },
      );
    }
    if (url.endsWith('/import')) return new Response(null, { status: 204 });
    if (method === 'POST' && url.endsWith('/api/librarian/chats'))
      return new Response(JSON.stringify({ id: 'fresh-chat' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    return new Response(JSON.stringify({ chats: [{ id: 'ongoing-chat' }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const onSaveAnswer = vi.fn(async () => {});
  setup({ askReady: true, linkId: 'quick-test', onSaveAnswer });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  await screen.findByText('Plain answer.');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save as note' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  expect(calls.find((call) => call.url.endsWith('/quick'))?.body).toEqual({
    linkId: 'quick-test',
    action: 'explain',
    quote: 'second paragraph',
    paragraph: 2,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue in Librarian' }));
  await waitFor(() => expect(calls.some((call) => call.url.endsWith('/import'))).toBe(true));
  // Continue starts a fresh chat for the article instead of appending to the ongoing one.
  const created = calls.find(
    (call) => call.method === 'POST' && call.url.endsWith('/api/librarian/chats'),
  );
  expect(created?.body).toEqual({ linkId: 'quick-test' });
  expect(calls.find((call) => call.url.endsWith('/import'))?.url).toContain(
    '/api/librarian/chats/fresh-chat/import',
  );
  expect(calls.some((call) => call.url.includes('ongoing-chat'))).toBe(false);
  const imported = calls.find((call) => call.url.endsWith('/import'))?.body as {
    messages: { role: string; parts: unknown[]; metadata?: unknown }[];
  };
  expect(imported.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  expect(imported.messages[1]?.parts).toEqual([{ type: 'text', text: 'Plain answer.' }]);
  expect(imported.messages[0]?.metadata).toEqual({
    action: 'explain',
    quote: 'second paragraph',
    paragraph: 2,
  });
  // Return to the bar and make a new temporary answer to exercise saving independently.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  await screen.findByText('Plain answer.');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save as note' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save as note' }));
  await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledWith('Plain answer.'));
  await screen.findByText('Saved as a note on ¶2');
  vi.unstubAllGlobals();
});

it('saves only the answer text, never the step text written before a tool call', async () => {
  const { waitFor } = await import('@testing-library/react');
  const chunks = [
    { type: 'start', messageId: 'answer' },
    { type: 'text-start', id: 's' },
    { type: 'text-delta', id: 's', delta: 'Let me read the article first.' },
    { type: 'text-end', id: 's' },
    { type: 'tool-input-available', toolCallId: 'call', toolName: 'get_link', input: {} },
    { type: 'tool-output-available', toolCallId: 'call', output: { text: 'article' } },
    { type: 'text-start', id: 'a' },
    { type: 'text-delta', id: 'a', delta: 'The real answer.' },
    { type: 'text-end', id: 'a' },
    { type: 'finish' },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
          {
            headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
          },
        ),
    ),
  );
  const onSaveAnswer = vi.fn(async () => {});
  setup({ askReady: true, linkId: 'steps-test', onSaveAnswer });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  await screen.findByText('The real answer.');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save as note' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save as note' }));
  await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledWith('The real answer.'));
  vi.unstubAllGlobals();
});

function answerStream(text: string, open = false) {
  return new Response(
    new ReadableStream({
      start(controller) {
        const chunks = [
          { type: 'start', messageId: text },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: text },
          ...(!open ? [{ type: 'text-end', id: 't' }, { type: 'finish' }] : []),
        ];
        controller.enqueue(
          new TextEncoder().encode(
            chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
              (!open ? 'data: [DONE]\n\n' : ''),
          ),
        );
        if (!open) controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } },
  );
}

it('aborts passage A and saves only passage B after the selection changes', async () => {
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith('/quick'))
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      calls++;
      if (calls === 1) {
        signal = init?.signal;
        return answerStream('Answer A', true);
      }
      return answerStream('Answer B');
    }),
  );
  const onSaveAnswer = vi.fn(async () => {});
  const props = setup({ askReady: true, linkId: 'selection-regression', onSaveAnswer });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  // While it streams, new words sit in their own spans, so match on the card's whole text.
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Passage answer' }).textContent).toContain(
      'Answer A',
    ),
  );
  const range = document.createRange();
  range.selectNodeContents(prose.querySelector('p')!);
  props.rendered.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <SelectionBar {...props} pending={{ ...pending, range }} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(signal?.aborted).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  await screen.findByText('Answer B');
  expect(screen.getByRole('region', { name: 'Passage answer' }).textContent).not.toContain(
    'Answer A',
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save as note' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save as note' }));
  await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledWith('Answer B'));
  vi.unstubAllGlobals();
});

it.each([
  ['approval_pending', 'Allow or deny the waiting request first.'],
  ['ai_not_ready', 'Turn on the Librarian in Settings first.'],
])('keeps the answer open when import returns %s', async (error, message) => {
  const { waitFor } = await import('@testing-library/react');
  const deleted: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/quick')) return answerStream('Keep this answer');
      if (String(input).endsWith('/import'))
        return new Response(JSON.stringify({ error, message: error }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      if (init?.method === 'DELETE') {
        deleted.push(String(input));
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ id: 'import-errors' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  setup({ askReady: true, linkId: `import-${error}` });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  await screen.findByText('Keep this answer');
  const button = screen.getByRole('button', { name: 'Continue in Librarian' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByText(message);
  expect(screen.getByRole('region', { name: 'Passage answer' })).toBeTruthy();
  expect(screen.getByText('Keep this answer')).toBeTruthy();
  // The refused import leaves no empty chat behind.
  await waitFor(() =>
    expect(deleted.some((url) => url.endsWith('/api/librarian/chats/import-errors'))).toBe(true),
  );
  vi.unstubAllGlobals();
});

it('focuses the quick answer and restores Ask focus when it closes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => answerStream('Focus answer')),
  );
  setup({ askReady: true, linkId: 'focus-answer' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  screen.getByRole('button', { name: 'Explain' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Passage answer' }));
  await screen.findByText('Focus answer');
  screen.getByRole('button', { name: 'Close answer' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Close answer' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask' }));
  vi.unstubAllGlobals();
});

const OWNER_ACTIONS = {
  librarianActions: {
    passage: [
      { id: 'explain', hidden: true },
      { id: 'simplify', hidden: false },
      { id: 'counterpoint', hidden: false },
      { id: 'define', hidden: false },
      { id: 'context', hidden: false },
      { id: 'related', hidden: false },
      {
        id: 'custom:11111111-1111-4111-8111-111111111111',
        label: 'Plain words',
        prompt: 'Say it plainly.',
      },
    ],
    article: [],
  },
};

function ownerFetch(
  quick: () => Response | Promise<Response>,
  calls: { url: string; body: unknown }[] = [],
  settings = () => OWNER_ACTIONS,
) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/quick')) return quick();
    if (url.endsWith('/import')) return new Response(null, { status: 204 });
    if (init?.method === 'POST' && url.endsWith('/api/librarian/chats'))
      return new Response(JSON.stringify({ id: 'fresh' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    return new Response(JSON.stringify(settings()), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

it('shows the owner chips: a hidden built-in is gone, a custom one follows the built-ins', async () => {
  ownerFetch(() => answerStream('x'));
  setup({ askReady: true, linkId: 'owner-chips' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(await screen.findByRole('button', { name: 'Plain words' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
  const names = Array.from(document.querySelectorAll('.silo-composer-quick button')).map(
    (b) => b.textContent,
  );
  expect(names).toEqual(['Simplify', 'Counterpoint', 'Plain words']);
  vi.unstubAllGlobals();
});

it('runs a custom chip by id, shows its label, and Continue carries both', async () => {
  const calls = ownerFetch(() => answerStream('Plainly said.'));
  setup({ askReady: true, linkId: 'owner-run' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Plain words' }));
  await screen.findByText('Plainly said.');
  expect(screen.getByRole('heading', { name: 'Plain words' })).toBeTruthy();
  const quick = calls.find((call) => call.url.endsWith('/quick'));
  const body = quick?.body as { action: string };
  expect(body.action).toBe('custom:11111111-1111-4111-8111-111111111111');
  expect(JSON.stringify(body)).not.toContain('Say it plainly');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue in Librarian' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue in Librarian' }));
  await waitFor(() => expect(calls.some((call) => call.url.endsWith('/import'))).toBe(true));
  const imported = calls.find((call) => call.url.endsWith('/import'))?.body as {
    messages: { parts: { text: string }[]; metadata?: { action?: string } }[];
  };
  expect(imported.messages[0]?.parts[0]?.text).toBe('Plain words');
  expect(imported.messages[0]?.metadata?.action).toBe(
    'custom:11111111-1111-4111-8111-111111111111',
  );
  vi.unstubAllGlobals();
});

it('says a removed action is gone and refreshes the settings', async () => {
  const calls = ownerFetch(
    () =>
      new Response(JSON.stringify({ error: 'unknown_action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  setup({ askReady: true, linkId: 'owner-gone' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Plain words' }));
  expect(await screen.findByText('This action was removed. Pick another.')).toBeTruthy();
  await waitFor(() =>
    expect(calls.filter((call) => call.url.endsWith('/api/settings')).length).toBeGreaterThan(1),
  );
  vi.unstubAllGlobals();
});

it.each(['quick', 'continue'])(
  'returns to refreshed selection chips when %s rejects a removed action',
  async (path) => {
    let stale = true;
    ownerFetch(
      () =>
        path === 'quick'
          ? new Response(
              JSON.stringify({
                error: 'unknown_action',
                message: 'Could not import conversation.',
              }),
              { status: 400 },
            )
          : answerStream('An answer.'),
      [],
      () =>
        stale
          ? OWNER_ACTIONS
          : {
              librarianActions: {
                ...OWNER_ACTIONS.librarianActions,
                passage: OWNER_ACTIONS.librarianActions.passage.filter(
                  (entry) => !entry.id.startsWith('custom:'),
                ),
              },
            },
    );
    const fetcher = vi.mocked(fetch);
    const original = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/quick')) stale = false;
      if (String(input).endsWith('/import'))
        return new Response(
          JSON.stringify({ error: 'unknown_action', message: 'Could not import conversation.' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (!original) throw new Error('Missing fetch fixture');
      return original(input, init);
    });
    setup({ askReady: true, linkId: `removed-selection-${path}` });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask about this passage' }), {
      target: { value: 'My draft question' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Plain words' }));
    if (path === 'continue') {
      await screen.findByText('An answer.');
      const button = screen.getByRole('button', { name: 'Continue in Librarian' });
      await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
      fireEvent.click(button);
    }
    expect(await screen.findByText('This action was removed. Pick another.')).toBeTruthy();
    const field = await screen.findByRole('textbox', { name: 'Ask about this passage' });
    expect((field as HTMLTextAreaElement).value).toBe('My draft question');
    expect(await screen.findByRole('button', { name: 'Simplify' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plain words' })).toBeNull());
    if (path === 'continue')
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    vi.unstubAllGlobals();
  },
);
