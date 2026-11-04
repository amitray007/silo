import { expect, it } from 'vitest';
import { persona, promptVersion, requestContext } from './persona.js';

it('versions the saved owner request instruction in the in-app persona', () => {
  expect(promptVersion).toBe(11);
  expect(persona).toContain(
    "An ownerAction is the owner's own saved request: follow its prompt for the attached passage, article or library, with the usual tools and rules.",
  );
  expect(persona).toContain('week (call list_links with since seven days before the request date');
  expect(persona).toContain('group what was saved by theme in a few lines with links');
  expect(persona).toContain('highlights (call list_highlights with no link, newest first');
  expect(persona).toContain('latest highlights and notes with their articles');
});
it('forbids dashes as punctuation in both personas', () => {
  expect(persona).toContain('Never use em dashes (—) or en dashes (–) as punctuation');
  expect(persona).toContain('use a comma, colon, period or parentheses instead');
});
it('omits a deleted custom action from an old user turn', () => {
  const context = JSON.parse(
    requestContext({
      chatId: 'old',
      link: null,
      messages: [
        {
          id: 'u',
          role: 'user',
          parts: [{ type: 'text', text: 'Old label' }],
          metadata: { action: 'custom:00000000-0000-4000-8000-000000000001' },
        },
      ],
    }),
  );
  expect(context).not.toHaveProperty('ownerAction');
  expect(context.selection.action).toBe('custom:00000000-0000-4000-8000-000000000001');
});
