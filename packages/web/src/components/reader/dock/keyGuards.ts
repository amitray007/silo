/**
 * Shared checks for the dock's keyboard commands (the pencil's and Listen's): when a key
 * belongs to the page, to a control, or to an overlay, the command must leave it alone.
 */

/** The dock's own sheet is a dialog too, and the dock's keys keep working beside it. */
const DOCK_SHEET_CLASS = 'silo-type-sheet';

const OTHER_OVERLAY = `[role="alertdialog"], [role="dialog"]:not(.${DOCK_SHEET_CLASS}), [role="menu"]`;
/** Controls that use the arrow keys themselves. */
export const OWN_ARROWS = '[role="radiogroup"], [role="spinbutton"], [role="listbox"], select';
/** Controls that Space presses. */
export const CONTROL = 'button, a[href], [role="radio"], [role="switch"], summary';

export function inTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function plain(event: KeyboardEvent): boolean {
  return !(event.metaKey || event.ctrlKey || event.altKey);
}

/** A key that is not allowed to run a dock command right now. */
export function blocked(event: KeyboardEvent): boolean {
  return (
    !plain(event) ||
    inTextEntry(event.target) ||
    inTextEntry(document.activeElement) ||
    document.querySelector(OTHER_OVERLAY) !== null
  );
}
