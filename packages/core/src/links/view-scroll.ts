import { createHash } from 'node:crypto';

/**
 * The only script a Silo view copy may run. It tells the parent reader how far
 * the page has scrolled, so the reader bar can hide on scroll like Reader does.
 * The copy's CSP allows this exact text by hash, and its sandbox has no
 * `allow-same-origin`, so the script runs on an opaque origin with no network.
 * It follows one page-sized scroller, switching only to a taller one, and bumps
 * `scroller` on a switch so the parent does not read the jump as a direction.
 */
export const VIEW_SCROLL_SCRIPT =
  "(()=>{let f=0,t=null,m=null,k=0;addEventListener('scroll',e=>{t=e.target;if(f)return;f=requestAnimationFrame(()=>{f=0;const s=t===document?document.scrollingElement:t;if(!s||s.clientHeight<innerHeight/2)return;if(s!==m){if(m&&s.clientHeight<=m.clientHeight)return;m=s;k++}parent.postMessage({type:'silo:view-scroll',top:s.scrollTop,max:s.scrollHeight-s.clientHeight,scroller:k},'*')})},{capture:true,passive:true})})()";

export const VIEW_SCROLL_SCRIPT_HASH = `sha256-${createHash('sha256').update(VIEW_SCROLL_SCRIPT).digest('base64')}`;

const TAG = `<script data-silo-view-scroll>${VIEW_SCROLL_SCRIPT}</script>`;

/**
 * Add the scroll reporter to sanitized view HTML. Appending after the serialized
 * document keeps page text out of the way: a `</head>` inside an attribute
 * cannot capture the tag, and the parser moves it into the body.
 */
export function addViewScrollScript(html: string): string {
  return html + TAG;
}
