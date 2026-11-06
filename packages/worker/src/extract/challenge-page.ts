/** Match the verification screen, not an article that merely discusses bot protection. */
export function isChallengePage(document: Document): boolean {
  const heading = [
    document.title,
    ...Array.from(
      document.querySelectorAll('h1, h2'),
      (node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ),
  ].join(' ');
  if (
    /just a moment|verify (?:to continue|(?:that )?you(?:'re| are) (?:a )?human)|attention required|pardon our interruption|are you a (?:human|robot)/i.test(
      heading,
    )
  )
    return true;
  // Walk text without cloning or mutating the document needed by embedded JSON.
  const walker = document.createTreeWalker(document.body, 4, {
    acceptNode(node) {
      return node.parentElement?.closest('script, style, template') ? 2 : 1;
    },
  });
  // Whitespace-collapsed text built node by node, so the walk can stop at the 5000-character
  // cap (past it neither verdict below can fire) instead of reading the whole page. Collapsing
  // a longer text only ever extends the shorter one, so the cut-off never changes an answer.
  let compact = '';
  while (walker.nextNode()) {
    const piece = (walker.currentNode.textContent ?? '').replace(/\s+/g, ' ');
    compact += compact === '' || compact.endsWith(' ') ? piece.trimStart() : piece;
    if (compact.length - (compact.endsWith(' ') ? 1 : 0) >= 5000) return false;
  }
  const text = compact.trim();
  const instruction =
    /checking (?:if )?(?:the |your )?(?:site )?connection is secure|enable javascript and cookies to continue|confirm (?:that )?you(?:'re| are) a human|(?:please )?verify (?:that )?you are (?:a )?human|press (?:and|&) hold to confirm|please enable js and disable any ad blocker|unusual traffic from your computer network/i;
  if (instruction.test(text)) return true;
  const vendor = document.querySelector(
    '[id^="cf-chl"], #challenge-form, #px-captcha, [id^="datadome"], script[src*="captcha-delivery.com/"], script[src*="geo.captcha-delivery.com/"]',
  );
  return Boolean(vendor && /verify|captcha|blocked|access denied|security check/i.test(text));
}
