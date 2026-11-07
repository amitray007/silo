import { type RefObject, useEffect } from 'react';
import { layoutMedia } from './breakpoints';

/** Software keyboards are far taller; a smaller gap is a scrollbar or browser chrome. */
const KEYBOARD_MIN_PX = 100;

export function useChatViewport(frame: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = frame.current;
    const viewport = window.visualViewport;
    if (!node || !viewport) return;
    const update = () => {
      const keyboardOpen =
        matchMedia(layoutMedia.fullWindowReader).matches &&
        viewport.scale === 1 &&
        viewport.height < window.innerHeight - KEYBOARD_MIN_PX;
      if (keyboardOpen) {
        node.style.setProperty('--silo-chat-viewport-height', `${viewport.height}px`);
        node.style.setProperty('--silo-chat-viewport-top', `${viewport.offsetTop}px`);
      } else {
        node.style.removeProperty('--silo-chat-viewport-height');
        node.style.removeProperty('--silo-chat-viewport-top');
      }
    };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      node.style.removeProperty('--silo-chat-viewport-height');
      node.style.removeProperty('--silo-chat-viewport-top');
    };
  }, [frame]);
}
