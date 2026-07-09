import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from '../test-support/chrome-mock.js';
import { showToast } from './toast.js';

describe('showToast', () => {
  let chrome: ReturnType<typeof installChromeMock>;
  beforeEach(() => {
    chrome = installChromeMock();
  });

  it('injects with the payload passed through args', async () => {
    await showToast(7, { kind: 'saved', title: 'T', url: 'https://x', linkId: 'id1', tags: [] });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 7 },
        args: [expect.objectContaining({ kind: 'saved', linkId: 'id1' })],
      }),
    );
  });

  it('swallows an injection failure', async () => {
    (
      chrome.scripting.executeScript as unknown as { mockRejectedValueOnce: (e: Error) => void }
    ).mockRejectedValueOnce(new Error('cannot inject'));
    await expect(
      showToast(7, { kind: 'saved', title: 'T', url: 'https://x', linkId: 'id1', tags: [] }),
    ).resolves.toBeUndefined();
  });
});
