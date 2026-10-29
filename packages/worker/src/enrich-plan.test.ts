import { describe, expect, it } from 'vitest';
import { planEnrich } from './enrich-plan.js';

describe('planEnrich', () => {
  it('leaves a full run on the existing pipeline', () => {
    expect(planEnrich({ enrichFields: null, sourceKind: 'twitter' })).toBeNull();
  });

  it.each([
    ['twitter', ['title'], { source: false, fetch: false, reader: false, aiTitle: true }],
    ['twitter', ['metadata'], { source: true, fetch: false, reader: false, aiTitle: false }],
    ['link', ['title'], { source: false, fetch: true, reader: false, aiTitle: false }],
    ['link', ['metadata'], { source: false, fetch: true, reader: false, aiTitle: false }],
    ['github', ['source'], { source: true, fetch: false, reader: false, aiTitle: false }],
    ['link', ['reader'], { source: false, fetch: true, reader: true, aiTitle: false }],
    ['twitter', ['reader'], { source: false, fetch: true, reader: true, aiTitle: false }],
    ['link', ['title', 'reader'], { source: false, fetch: true, reader: true, aiTitle: false }],
    ['twitter', ['title', 'reader'], { source: false, fetch: true, reader: true, aiTitle: true }],
    [
      'twitter',
      ['title', 'metadata', 'source', 'reader'],
      { source: true, fetch: true, reader: true, aiTitle: true },
    ],
  ] as const)('plans %s %j', (sourceKind, enrichFields, expected) => {
    expect(planEnrich({ sourceKind, enrichFields })).toMatchObject(expected);
  });
});
