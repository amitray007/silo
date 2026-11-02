import type { KeyboardEvent } from 'react';

export const PICK = '.silo-chat-history-pick';
const DELETE = '.silo-chat-history-del';
const CONFIRM = '.silo-chat-history-confirm button';

/** The pick button of every row, in order: the stops Arrow keys visit. */
export function pickButtons(list: ParentNode | null): HTMLElement[] {
  return list ? Array.from(list.querySelectorAll<HTMLElement>(PICK)) : [];
}

function swallow(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/** Where Up, Down, Home and End send focus, as a row index (negative counts from the end). */
const WALK: Record<string, (at: number) => number> = {
  ArrowDown: (at) => at + 1,
  ArrowUp: (at) => (at < 0 ? -1 : at - 1),
  Home: () => 0,
  End: () => -1,
};

/** The button Left or Right reaches from `target` inside its row. */
function acrossRow(target: HTMLElement, row: HTMLElement | null): HTMLElement | undefined {
  if (!row) return undefined;
  if (target.matches(PICK)) return row.querySelector<HTMLElement>(DELETE) ?? undefined;
  if (target.matches(DELETE)) return row.querySelector<HTMLElement>(PICK) ?? undefined;
  const confirm = Array.from(row.querySelectorAll<HTMLElement>(CONFIRM));
  return confirm[(confirm.indexOf(target) + 1) % confirm.length];
}

/**
 * Keys for the history list. Up and Down walk the rows, Right and Left step between a row's pick
 * and delete buttons (or its confirm buttons), Delete asks to delete the focused row. Handled keys
 * stop here so the menu surface does not also move focus.
 */
export function onHistoryKey(event: KeyboardEvent<HTMLElement>, askDelete: (id: string) => void) {
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLElement>('[data-chat]');
  const rows = pickButtons(event.currentTarget);
  const walk = WALK[event.key];
  if (walk && rows.length) {
    const at = row ? rows.findIndex((pick) => row.contains(pick)) : -1;
    swallow(event);
    rows[(walk(at) + rows.length) % rows.length]?.focus();
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const next = acrossRow(target, row);
    if (!next) return;
    swallow(event);
    next.focus();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!row?.dataset.chat || !target.matches(`${PICK}, ${DELETE}`)) return;
    swallow(event);
    askDelete(row.dataset.chat);
  }
}
