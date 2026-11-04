import { z } from 'zod';
import { AI_PROVIDER_KINDS } from '../ai/model-types.js';
import {
  ARTICLE_ACTION_IDS,
  customActionIdSchema,
  LIBRARY_ACTION_IDS,
  PASSAGE_ACTION_IDS,
} from './actions.js';

const librarianModelSchema = z
  .object({ provider: z.enum(AI_PROVIDER_KINDS), id: z.string().min(1).max(512) })
  .strict();
const answerMetadata = z
  .object({
    model: librarianModelSchema.extend({ label: z.string().min(1).max(256) }).optional(),
    suggestions: z
      .array(z.object({ kind: z.enum(['ask', 'do']), text: z.string().max(96) }))
      .max(3)
      .optional(),
  })
  .passthrough();
export const answerVersionSchema = z
  .object({
    id: z.string().min(1).max(200),
    parts: z.array(z.unknown()).max(200),
    metadata: answerMetadata.refine((m) => !('versions' in m)),
  })
  .strict()
  .refine((v) => JSON.stringify(v).length <= 1000000);
export const regenerateRequestSchema = z
  .object({
    trigger: z.literal('regenerate'),
    messageId: z.string().min(1).max(200),
    model: librarianModelSchema.optional(),
  })
  .strict();

export const suggestionsSchema = z
  .array(z.object({ kind: z.enum(['ask', 'do']), text: z.string().min(1).max(96) }))
  .max(3);
export const librarianMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  parts: z.array(z.unknown()).max(200),
  metadata: z
    .object({
      suggestions: suggestionsSchema.optional(),
      model: answerMetadata.shape.model,
      versions: z.array(answerVersionSchema).max(5).optional(),
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

const actionIdSchema = z.union([
  z.enum([...PASSAGE_ACTION_IDS, ...ARTICLE_ACTION_IDS, ...LIBRARY_ACTION_IDS]),
  customActionIdSchema,
]);

export const incomingUserMessageSchema = librarianMessageSchema
  .extend({
    role: z.literal('user'),
    metadata: librarianMessageSchema.shape.metadata
      .unwrap()
      .extend({
        action: actionIdSchema.optional(),
      })
      .optional(),
    parts: z
      .array(z.object({ type: z.literal('text'), text: z.string().min(1).max(20000) }).strict())
      .min(1)
      .max(50),
  })
  .strict();

const quickActionSchema = actionIdSchema;
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
