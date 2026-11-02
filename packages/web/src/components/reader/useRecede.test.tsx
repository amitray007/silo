import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useRecede } from './useRecede';

function Probe({ passage, chat }: { passage: boolean; chat: boolean }) {
  const host = document.getElementById('host');
  useRecede(host, 'passage', passage);
  useRecede(host, 'chat', chat);
  return null;
}

const pane = () => document.querySelector('.silo-readerpane') as HTMLElement;

it('marks the reader pane while a reason holds, and clears it when the last reason ends', () => {
  document.body.innerHTML = '<section class="silo-readerpane"><div id="host"></div></section>';
  const view = render(<Probe passage={false} chat={false} />);
  expect(pane().hasAttribute('data-recede')).toBe(false);
  view.rerender(<Probe passage chat={false} />);
  expect(pane().getAttribute('data-recede')).toBe('passage');
  view.rerender(<Probe passage chat />);
  expect(pane().getAttribute('data-recede')).toBe('passage chat');
  view.rerender(<Probe passage={false} chat />);
  expect(pane().getAttribute('data-recede')).toBe('chat');
  view.unmount();
  expect(pane().hasAttribute('data-recede')).toBe(false);
});

it('drops the blur and the transition under reduced motion', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/reader-recede.css'), 'utf8');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduced).toContain('transition: none');
  expect(reduced).toContain('text-shadow: none');
  expect(reduced).toContain('filter: none');
});
