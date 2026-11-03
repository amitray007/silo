/**
 * The Librarian's quick actions, as the owner arranges them in Settings. Web's own copy of the
 * stored shape (core owns the strict schema): a built-in is `{ id, hidden }`, a custom action is
 * `{ id: 'custom:<uuid>', label, prompt }`. Order is list order.
 */
type BuiltinEntry = { id: string; hidden: boolean };
export type CustomEntry = { id: string; label: string; prompt: string };
export type ActionEntry = BuiltinEntry | CustomEntry;
export type LibrarianActions = { passage: ActionEntry[]; article: ActionEntry[] };
export type ActionList = keyof LibrarianActions;
/** A chip: its id travels as message metadata, its label is the message text. */
export type Chip = readonly [id: string, label: string];

export const LABEL_MAX = 24;
export const PROMPT_MAX = 1000;
export const CUSTOM_MAX = 6;
const CHIPS_MAX = 6;

/** The built-ins in their default order, with the label each chip shows. */
export const BUILTIN_LABELS: Record<ActionList, readonly Chip[]> = {
  passage: [
    ['explain', 'Explain'],
    ['simplify', 'Simplify'],
    ['counterpoint', 'Counterpoint'],
    ['define', 'Define'],
    ['context', 'In context'],
    ['related', 'Related'],
  ],
  article: [
    ['summary', 'Summarize'],
    ['claims', 'Key claims'],
    ['my-notes', 'My notes here'],
    ['related', 'Related'],
  ],
};
const PHRASE_IDS = new Set(['explain', 'simplify', 'counterpoint']);
const WORD_IDS = new Set(['define', 'context', 'related']);

export const isCustom = (entry: ActionEntry): entry is CustomEntry => 'prompt' in entry;

export const defaultList = (list: ActionList): ActionEntry[] =>
  BUILTIN_LABELS[list].map(([id]) => ({ id, hidden: false }));

export const defaultActions = (): LibrarianActions => ({
  passage: defaultList('passage'),
  article: defaultList('article'),
});

/** The stored value, with any built-in it lacks appended visible (an older value, a new built-in). */
export function resolveActions(stored: Partial<LibrarianActions> | null | undefined) {
  const out = defaultActions();
  for (const list of ['passage', 'article'] as const) {
    const entries = stored?.[list];
    if (!Array.isArray(entries)) continue;
    const have = new Set(entries.map((entry) => entry.id));
    const known = new Set(BUILTIN_LABELS[list].map(([id]) => id));
    const kept = entries.filter((entry) => isCustom(entry) || known.has(entry.id));
    const missing = defaultList(list).filter((entry) => !have.has(entry.id));
    out[list] = [...kept, ...missing];
  }
  return out;
}

const labelOf = (list: ActionList, id: string) =>
  BUILTIN_LABELS[list].find(([key]) => key === id)?.[1] ?? id;

function visible(list: ActionList, entries: readonly ActionEntry[]) {
  const out: { chip: Chip; custom: boolean }[] = [];
  for (const entry of entries) {
    if (isCustom(entry)) out.push({ chip: [entry.id, entry.label], custom: true });
    else if (!entry.hidden) out.push({ chip: [entry.id, labelOf(list, entry.id)], custom: false });
  }
  return out;
}

/** A passage set shows custom chips after its visible built-ins; an article list keeps list order. */
function chipsFor(list: ActionList, entries: readonly ActionEntry[], only?: Set<string>) {
  const shown = visible(list, entries).filter(
    ({ chip, custom }) => custom || !only || only.has(chip[0]),
  );
  const ordered =
    list === 'passage'
      ? [...shown.filter((item) => !item.custom), ...shown.filter((item) => item.custom)]
      : shown;
  return ordered.map((item) => item.chip);
}

/** The chips of a phrase, or of a single word, in the selection composer. */
export function passageChips(actions: LibrarianActions, word: boolean): Chip[] {
  return chipsFor('passage', actions.passage, word ? WORD_IDS : PHRASE_IDS);
}
export const articleChips = (actions: LibrarianActions): Chip[] =>
  chipsFor('article', actions.article);

/** A selection of one short word gets the word set. */
export const isWord = (quote: string) => !/\s/.test(quote) && quote.length <= 32;

/** The label of the action an id names, for the card and Continue. */
export function chipLabel(actions: LibrarianActions, id: string) {
  for (const list of ['passage', 'article'] as const) {
    const entry = actions[list].find((item) => item.id === id);
    if (entry) return isCustom(entry) ? entry.label : labelOf(list, id);
  }
  return undefined;
}

export type FieldErrors = { label?: string; prompt?: string };
export function validateCustom(label: string, prompt: string): FieldErrors {
  const errors: FieldErrors = {};
  const name = label.trim();
  if (!name) errors.label = 'Give the action a label.';
  else if (name.length > LABEL_MAX) errors.label = `Keep the label to ${LABEL_MAX} characters.`;
  const text = prompt.trim();
  if (!text) errors.prompt = 'Write the prompt the Librarian should follow.';
  else if (text.length > PROMPT_MAX) errors.prompt = `Keep the prompt to ${PROMPT_MAX} characters.`;
  return errors;
}

/** The reason a list cannot be saved, or null when it fits every limit. */
export function listProblem(list: ActionList, entries: readonly ActionEntry[]): string | null {
  if (entries.filter(isCustom).length > CUSTOM_MAX)
    return `A list holds at most ${CUSTOM_MAX} custom actions.`;
  const sets =
    list === 'passage'
      ? [
          ['phrases', chipsFor(list, entries, PHRASE_IDS)],
          ['single words', chipsFor(list, entries, WORD_IDS)],
        ]
      : [['this list', chipsFor(list, entries)]];
  for (const [name, chips] of sets as [string, Chip[]][])
    if (chips.length > CHIPS_MAX)
      return `At most ${CHIPS_MAX} chips can show for ${name}. Hide one first.`;
  return null;
}

export function moveEntry(entries: readonly ActionEntry[], id: string, by: -1 | 1) {
  const from = entries.findIndex((entry) => entry.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= entries.length) return [...entries];
  const next = [...entries];
  const [item] = next.splice(from, 1);
  if (item) next.splice(to, 0, item);
  return next;
}
