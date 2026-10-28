import { describe, expect, it, vi } from 'vitest';
import { runEnrichJob } from './enrich-job.js';

describe('runEnrichJob', () => {
  it('passes linkId, trigger and previousStatus through to enrichLink', async () => {
    const enrich = vi.fn(async () => {});
    await runEnrichJob({ linkId: 'a', trigger: 'manual', previousStatus: 'full' }, enrich);
    expect(enrich).toHaveBeenCalledWith('a', undefined, {
      trigger: 'manual',
      previousStatus: 'full',
    });
  });

  it('treats a legacy payload (linkId only) as a sweep of an enriching link', async () => {
    const enrich = vi.fn(async () => {});
    await runEnrichJob({ linkId: 'a' }, enrich);
    expect(enrich).toHaveBeenCalledWith('a', undefined, {
      trigger: 'sweep',
      previousStatus: 'enriching',
    });
  });

  it('drops a payload with no linkId without calling enrichLink', async () => {
    const enrich = vi.fn(async () => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runEnrichJob({ trigger: 'manual' }, enrich);
      await runEnrichJob(null, enrich);
      expect(enrich).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });
});
