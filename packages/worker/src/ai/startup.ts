import { reencryptAiProviders, secretKeyStatus } from '@silo/core';
import './registry.js'; // worker.ts loads this file, so the registry drift guard runs at worker startup

type StartupDeps = {
  reencrypt: typeof reencryptAiProviders;
  keyStatus: typeof secretKeyStatus;
};

/**
 * Worker-startup AI housekeeping: moves provider keys onto the current
 * `SILO_SECRET_KEY` and warns about a malformed one. Best effort: AI must
 * never stop the worker, so it never throws. Logs counts and the variable
 * name only, never a key or an error message.
 */
export async function prepareAiAtStartup(
  deps: StartupDeps = { reencrypt: reencryptAiProviders, keyStatus: secretKeyStatus },
): Promise<void> {
  try {
    if (deps.keyStatus() === 'invalid') {
      console.warn('silo ai: SILO_SECRET_KEY is not 32 bytes of base64; AI stays unavailable');
      return;
    }
    const { reencrypted, unreadable } = await deps.reencrypt();
    if (reencrypted > 0 || unreadable > 0) {
      console.warn(
        `silo ai: re-encrypted ${reencrypted} provider key(s), ${unreadable} unreadable`,
      );
    }
  } catch {
    console.warn('silo ai: startup key re-encryption failed; AI keys were left as they were');
  }
}
