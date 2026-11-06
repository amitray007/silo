import { type RefObject, useEffect } from 'react';
import { layoutMedia } from './breakpoints';

export function useChatViewport(frame: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = frame.current;
    const viewport = window.visualViewport;
    if (!node || !viewport) return;
    let mounted = true;
    const update = () => {
      const focused = document.activeElement;
      const chatField = focused instanceof HTMLTextAreaElement && focused.closest('.silo-chat');
      const keyboardOpen =
        chatField &&
        matchMedia(layoutMedia.fullWindowReader).matches &&
        viewport.scale === 1 &&
        viewport.height < window.innerHeight - 1;
      if (keyboardOpen) {
        node.style.setProperty('--silo-chat-viewport-height', `${viewport.height}px`);
        node.style.setProperty('--silo-chat-viewport-top', `${viewport.offsetTop}px`);
      } else {
        node.style.removeProperty('--silo-chat-viewport-height');
        node.style.removeProperty('--silo-chat-viewport-top');
      }
    };
    const afterFocus = () => queueMicrotask(() => mounted && update());
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', afterFocus);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      mounted = false;
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', afterFocus);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      node.style.removeProperty('--silo-chat-viewport-height');
      node.style.removeProperty('--silo-chat-viewport-top');
    };
  }, [frame]);
}
