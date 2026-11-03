import { expect, it } from 'vitest';
import { persona, promptVersion, requestContext } from './persona.js';

it('versions the saved owner request instruction in the in-app persona', () => {
  expect(promptVersion).toBe(9);
  expect(persona).toContain(
    "An ownerAction is the owner's own saved request: follow its prompt for the attached passage or article, with the usual tools and rules.",
  );
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
