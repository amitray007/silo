import { z } from 'zod';
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
