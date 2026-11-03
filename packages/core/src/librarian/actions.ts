import { z } from 'zod';

export const PASSAGE_PHRASE_ACTION_IDS = ['explain', 'simplify', 'counterpoint'] as const;
export const PASSAGE_WORD_ACTION_IDS = ['define', 'context', 'related'] as const;
export const PASSAGE_ACTION_IDS = [
  ...PASSAGE_PHRASE_ACTION_IDS,
  ...PASSAGE_WORD_ACTION_IDS,
] as const;
export const ARTICLE_ACTION_IDS = ['summary', 'claims', 'my-notes', 'related'] as const;
export const LIBRARY_ACTION_IDS = ['week', 'highlights'] as const;
export const customActionIdSchema = z
  .string()
  .regex(/^custom:/)
  .refine((id) => z.string().uuid().safeParse(id.slice('custom:'.length)).success);
const customActionSchema = z
  .object({
    id: customActionIdSchema,
    label: z.string().trim().min(1).max(24),
    prompt: z.string().trim().min(1).max(1000),
  })
  .strict();
const passageEntrySchema = z.union([
  z.object({ id: z.enum(PASSAGE_ACTION_IDS), hidden: z.boolean() }).strict(),
  customActionSchema,
]);
const articleEntrySchema = z.union([
  z.object({ id: z.enum(ARTICLE_ACTION_IDS), hidden: z.boolean() }).strict(),
  customActionSchema,
]);
const libraryEntrySchema = z.union([
  z.object({ id: z.enum(LIBRARY_ACTION_IDS), hidden: z.boolean() }).strict(),
  customActionSchema,
]);
export type LibrarianActionKind = 'passage' | 'article' | 'library';
export type OwnerAction = Pick<z.infer<typeof customActionSchema>, 'label' | 'prompt'>;

function actionList<S extends z.ZodType<{ id: string; hidden?: boolean; prompt?: string }>>(
  entry: S,
  sets: readonly (readonly string[])[],
  requireBuiltins: boolean,
) {
  return z.array(entry).superRefine((entries, ctx) => {
    const ids = new Set(entries.map((item) => item.id));
    const customCount = entries.filter((item) => 'prompt' in item).length;
    if (ids.size !== entries.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate action ids.' });
    if (requireBuiltins && sets.flat().some((id) => !ids.has(id)))
      ctx.addIssue({ code: 'custom', message: 'Every built-in action must appear exactly once.' });
    if (customCount > 6)
      ctx.addIssue({ code: 'custom', message: 'At most 6 custom actions per list.' });
    for (const set of sets) {
      const visible = entries.filter(
        (item) => 'hidden' in item && !item.hidden && set.includes(item.id),
      );
      if (visible.length + customCount > 6)
        ctx.addIssue({ code: 'custom', message: 'At most 6 visible chips per set.' });
    }
  });
}

function actionsSchema(requireBuiltins: boolean) {
  return z
    .object({
      passage: actionList(
        passageEntrySchema,
        [PASSAGE_PHRASE_ACTION_IDS, PASSAGE_WORD_ACTION_IDS],
        requireBuiltins,
      ),
      article: actionList(articleEntrySchema, [ARTICLE_ACTION_IDS], requireBuiltins),
      library: requireBuiltins
        ? actionList(libraryEntrySchema, [LIBRARY_ACTION_IDS], true)
        : actionList(libraryEntrySchema, [LIBRARY_ACTION_IDS], false).default([]),
    })
    .strict();
}
export const librarianActionsSchema = actionsSchema(true);
export type LibrarianActions = z.infer<typeof librarianActionsSchema>;
export const LIBRARIAN_ACTIONS_DEFAULTS: LibrarianActions = {
  passage: PASSAGE_ACTION_IDS.map((id) => ({ id, hidden: false })),
  article: ARTICLE_ACTION_IDS.map((id) => ({ id, hidden: false })),
  library: LIBRARY_ACTION_IDS.map((id) => ({ id, hidden: false })),
};

/** Fill registry additions on reads without losing the owner's order or choices. */
export const librarianActionsStoredSchema = actionsSchema(false).transform((value) => ({
  passage: [
    ...value.passage,
    ...LIBRARIAN_ACTIONS_DEFAULTS.passage.filter(
      (builtin) => !value.passage.some((entry) => entry.id === builtin.id),
    ),
  ],
  article: [
    ...value.article,
    ...LIBRARIAN_ACTIONS_DEFAULTS.article.filter(
      (builtin) => !value.article.some((entry) => entry.id === builtin.id),
    ),
  ],
  library: [
    ...value.library,
    ...LIBRARIAN_ACTIONS_DEFAULTS.library.filter(
      (builtin) => !value.library.some((entry) => entry.id === builtin.id),
    ),
  ],
}));
