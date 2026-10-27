import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderProse } from './ReaderProse';

const html =
  '<p>Intro</p><figure><img src="https://a.test/one.png" alt="First chart"><figcaption>Figure one</figcaption></figure>' +
  '<p><a href="https://a.test/full.png"><img src="https://a.test/two.png" alt="Second"></a></p>' +
  '<p><img src="https://a.test/icon.png" alt="icon"></p>';

beforeEach(() => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    return this.alt === 'icon' ? 24 : 1600;
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    return this.alt === 'icon' ? 24 : 900;
  });
});

afterEach(() => vi.restoreAllMocks());

function show() {
  const view = render(
    <ReaderProse
      linkId="viewer"
      reader={{ contentHtml: html, contentImages: ['/a', '/b', '/c'] }}
    />,
  );
  const images = [...view.container.querySelectorAll('img')];
  return { ...view, images };
}

describe('Reader image viewer', () => {
  it('makes article images, but not icons, into buttons', () => {
    const { images } = show();
    expect(images.map((image) => image.getAttribute('role'))).toEqual(['button', 'button', null]);
    expect(images[0]?.getAttribute('aria-label')).toBe('View image: First chart');
    expect(images[0]?.tabIndex).toBe(0);
  });

  it('opens on click with the caption and steps between images', () => {
    const { images } = show();
    fireEvent.click(images[0] as HTMLImageElement);
    const dialog = screen.getByRole('dialog', { name: 'Image: First chart' });
    expect(within(dialog).getByText('1 / 2')).toBeDefined();
    expect(within(dialog).getByText('Figure one')).toBeDefined();
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByRole('dialog', { name: 'Image: Second' })).toBeDefined();
    // An image inside a link keeps that link for "Open in new tab".
    expect(screen.getByRole('link', { name: 'Open in new tab' }).getAttribute('href')).toBe(
      'https://a.test/full.png',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    expect(within(screen.getByRole('dialog')).getByText('2 / 2')).toBeDefined();
  });

  it('opens from the keyboard, keeps app shortcuts out, and closes on Escape', () => {
    const { images } = show();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    fireEvent.keyDown(images[1] as HTMLImageElement, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(document.activeElement as Element, { key: 'j' });
    expect(outside).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    document.removeEventListener('keydown', outside);
  });

  it('zooms with the toolbar and fits again', () => {
    const { images } = show();
    fireEvent.click(images[0] as HTMLImageElement);
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
    expect(zoomOut.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const stageImage = screen.getByRole('dialog').querySelector('.silo-viewer-stage img');
    expect((stageImage as HTMLElement).style.transform).toContain('scale(1.5)');
    expect(zoomOut.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Fit to screen' }));
    expect((stageImage as HTMLElement).style.transform).toContain('scale(1)');
  });

  it('pans from the pinched view when one finger lifts and the other keeps moving', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Element.prototype.setPointerCapture = () => {};
    const { images } = show();
    fireEvent.click(images[0] as HTMLImageElement);
    const stage = screen.getByRole('dialog').querySelector('.silo-viewer-stage') as HTMLElement;
    const image = stage.querySelector('img') as HTMLElement;
    const pointer = (type: string, id: number, x: number, y: number) =>
      fireEvent(
        stage,
        Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }), {
          pointerId: id,
        }),
      );
    const offset = () => Number(/translate\((-?[\d.]+)px/.exec(image.style.transform)?.[1]);
    pointer('pointerdown', 1, 400, 400);
    pointer('pointerdown', 2, 600, 400);
    pointer('pointermove', 2, 700, 400);
    pointer('pointerup', 1, 400, 400);
    const pinched = offset();
    expect(image.style.transform).not.toContain('scale(1)');
    pointer('pointermove', 2, 690, 400);
    expect(offset()).toBeCloseTo(pinched - 10, 5);
  });
});
