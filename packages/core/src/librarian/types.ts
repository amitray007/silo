import { z } from 'zod';
import { ARTICLE_ACTION_IDS, customActionIdSchema, PASSAGE_ACTION_IDS } from './actions.js';
export const librarianMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  parts: z.array(z.unknown()).max(200),
  metadata: z
    .object({
      quote: z.string().max(2000).optional(),
      paragraph: z.number().int().nonnegative().optional(),
      action: z.string().max(100).optional(),
    })
    .passthrough()
    .optional(),
});
export type LibrarianMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: unknown[];
  metadata?: unknown;
};

export const incomingUserMessageSchema = librarianMessageSchema
  .extend({
    role: z.literal('user'),
    metadata: librarianMessageSchema.shape.metadata
      .unwrap()
      .extend({
        action: z
          .union([z.enum([...PASSAGE_ACTION_IDS, ...ARTICLE_ACTION_IDS]), customActionIdSchema])
          .optional(),
      })
      .optional(),
    parts: z
      .array(z.object({ type: z.literal('text'), text: z.string().min(1).max(20000) }).strict())
      .min(1)
      .max(50),
  })
  .strict();

const quickActionSchema = z.union([z.enum(PASSAGE_ACTION_IDS), customActionIdSchema]);
export const quickRequestSchema = z
  .object({
    linkId: z.string().uuid(),
    action: quickActionSchema,
    quote: z.string().min(1).max(2000),
    paragraph: z.number().int().nonnegative(),
  })
  .strict();
const importedUser = incomingUserMessageSchema.extend({
  metadata: z
    .object({
      action: quickActionSchema,
      quote: z.string().min(1).max(2000),
      paragraph: z.number().int().nonnegative(),
    })
    .strict(),
});
const importedAssistant = librarianMessageSchema
  .extend({
    role: z.literal('assistant'),
    parts: z
      .array(z.object({ type: z.literal('text'), text: z.string().min(1).max(20000) }).strict())
      .min(1)
      .max(50),
  })
  .omit({ metadata: true })
  .strict()
  .refine((m) => m.parts.reduce((n, p) => n + p.text.length, 0) <= 20000);
export const importMessagesSchema = z
  .object({ messages: z.tuple([importedUser, importedAssistant]) })
  .strict();
