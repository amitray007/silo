import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OutlineRail } from './OutlineRail';

function setup(width = 900) {
  const panel = document.createElement('section');
  const scroll = document.createElement('div');
  const prose = document.createElement('div');
  prose.innerHTML = `<h2>Intro heading</h2><p>First paragraph of the article, with words.</p>
    <h2>Second part</h2><p>Another paragraph.</p>`;
  scroll.append(prose);
  panel.append(scroll);
  document.body.append(panel);
  Object.defineProperty(panel, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(panel, 'clientHeight', { value: 800, configurable: true });
  scroll.scrollTo = vi.fn();
  return { panel, scroll, prose };
}

// The library caches the media query on first use, so the test drives the hook directly.
let reducedMotion = false;
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => reducedMotion,
}));

beforeEach(() => {
  document.body.innerHTML = '';
  reducedMotion = false;
});

it('is a navigation landmark with a labelled button per group', () => {
  const { panel, scroll, prose } = setup();
  render(<OutlineRail prose={prose} scroll={scroll} panel={panel} />);
  expect(screen.getByRole('navigation', { name: 'Article outline' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Intro heading' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Second part' })).toBeDefined();
});

it('is hidden when the pane is narrower than 700px', () => {
  const { panel, scroll, prose } = setup(699);
  render(<OutlineRail prose={prose} scroll={scroll} panel={panel} />);
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('scrolls to a group on click, smoothly', () => {
  const { panel, scroll, prose } = setup();
  render(<OutlineRail prose={prose} scroll={scroll} panel={panel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Second part' }));
  expect(scroll.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
});

it('shows a card for the focused tick with its title', () => {
  const { panel, scroll, prose } = setup();
  render(<OutlineRail prose={prose} scroll={scroll} panel={panel} />);
  fireEvent.focus(screen.getByRole('button', { name: 'Second part' }));
  const card = document.querySelector('.silo-outline-card');
  expect(card?.textContent).toContain('Second part');
  expect(card?.textContent).toContain('Another paragraph.');
});

it('with reduced motion: no spring widths, a static crest, an instant scroll', () => {
  reducedMotion = true;
  const { panel, scroll, prose } = setup();
  render(<OutlineRail prose={prose} scroll={scroll} panel={panel} />);
  const tick = screen.getByRole('button', { name: 'Second part' });
  fireEvent.focus(tick);
  expect(tick.getAttribute('data-crest')).toBe('true');
  expect(tick.querySelector('i')?.getAttribute('style') ?? '').not.toContain('width');
  fireEvent.click(tick);
  expect(scroll.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
});
