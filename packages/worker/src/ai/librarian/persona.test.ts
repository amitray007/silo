import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { persona, promptVersion } from './persona.js';

it('preserves the version 8 in-app prompt byte for byte', () => {
  expect(promptVersion).toBe(8);
  expect(createHash('sha256').update(persona).digest('hex')).toBe(
    'f780aaeace42fdca1ef20842d782e6167fbbacebeacf800962009b0fea252873',
  );
});
