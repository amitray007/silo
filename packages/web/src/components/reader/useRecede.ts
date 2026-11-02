import { useEffect } from 'react';

/** Why the article recedes: a passage is open in the composer or answer card, or the chat is. */
export type RecedeReason = 'passage' | 'chat';

/** Mark the reader pane as receding. `styles/reader-recede.css` does the dimming and blurring. */
export function useRecede(host: Element | null, reason: RecedeReason, active: boolean) {
  useEffect(() => {
    const pane = host?.closest('.silo-readerpane');
    if (!pane || !active) return;
    const reasons = (pane.getAttribute('data-recede') ?? '').split(' ').filter(Boolean);
    pane.setAttribute('data-recede', [...new Set([...reasons, reason])].join(' '));
    return () => {
      const rest = (pane.getAttribute('data-recede') ?? '')
        .split(' ')
        .filter((r) => r && r !== reason);
      if (rest.length) pane.setAttribute('data-recede', rest.join(' '));
      else pane.removeAttribute('data-recede');
    };
  }, [host, reason, active]);
}
