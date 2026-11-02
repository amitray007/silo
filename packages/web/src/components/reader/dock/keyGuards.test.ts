import { afterEach, describe, expect, it } from 'vitest';
import { blocked } from './keyGuards';

function press(init: KeyboardEventInit, target: Element = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('blocked', () => {
  it('lets a plain key through on the page', () => {
    expect(blocked(press({ key: ' ' }))).toBe(false);
  });

  it('blocks Ctrl, Alt and Meta combinations', () => {
    for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(blocked(press({ key: 'ArrowRight', ...mod }))).toBe(true);
    }
  });

  it('blocks keys typed into a field, a textarea, a select or an editable element', () => {
    document.body.innerHTML =
      '<input id="a"><textarea id="b"></textarea><select id="c"></select><div id="d" contenteditable="true"></div>';
    for (const id of ['a', 'b', 'c']) {
      expect(blocked(press({ key: 'a' }, document.getElementById(id) as Element))).toBe(true);
    }
    const editable = document.getElementById('d') as HTMLElement;
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(blocked(press({ key: 'a' }, editable))).toBe(true);
  });

  it('blocks keys while focus sits in a text field, whatever the event target', () => {
    document.body.innerHTML = '<input id="a">';
    (document.getElementById('a') as HTMLElement).focus();
    expect(blocked(press({ key: ' ' }))).toBe(true);
  });

  it('blocks keys while another dialog or menu is open, but not while only the dock sheet is', () => {
    document.body.innerHTML = '<div role="dialog" class="silo-type-sheet"></div>';
    expect(blocked(press({ key: ' ' }))).toBe(false);
    document.body.innerHTML = '<div role="dialog" aria-label="Note"></div>';
    expect(blocked(press({ key: ' ' }))).toBe(true);
    document.body.innerHTML = '<div role="menu"></div>';
    expect(blocked(press({ key: ' ' }))).toBe(true);
    document.body.innerHTML = '<div role="alertdialog"></div>';
    expect(blocked(press({ key: ' ' }))).toBe(true);
  });
});
