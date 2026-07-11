import { useEffect, useRef, useState } from 'react';

/**
 * A tri-state copy-flash label: `null` = never clicked, `true` = last copy
 * succeeded, `false` = last copy failed. Shared by every copy affordance
 * across the Access tab (originally `AccessTab.tsx`'s Copy config / Copy
 * token, now also `McpSetupDialog.tsx`'s per-row Copy buttons — lifted out
 * once a second file needed the identical hook rather than duplicating it,
 * which `jscpd` would've flagged) so a failed clipboard write never looks
 * identical to a successful one (review fix, ce-correctness) — insecure
 * context / denied permission / non-user-gesture embeddings all reject
 * `writeText`. Each caller gets its OWN independent state/timer (one
 * `useCopyFlash()` call per copyable field) since each button's label must
 * flip independently — copying one field must not also flip another's label.
 */
export function useCopyFlash() {
  const [copied, setCopied] = useState<boolean | null>(null);
  // Holds the pending "reset the label" timer so it can be cleared if the
  // owning component unmounts (modal closed / tab switched) before it fires
  // — otherwise it'd call setState on an unmounted component (review fix,
  // ce-correctness).
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const flash = (ok: boolean) => {
    setCopied(ok);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(null), 1500);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => flash(true),
      () => flash(false),
    );
  };

  return { copied, copyText };
}

/** Renders a copy-flash tri-state onto a button label — shared by every `useCopyFlash` caller. */
export function copyLabel(copied: boolean | null, idleLabel: string): string {
  return copied === true ? 'Copied' : copied === false ? "Couldn't copy" : idleLabel;
}
