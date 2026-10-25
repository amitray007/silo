/** Match the verification screen, not an article that merely discusses bot protection. */
export function isChallengePage(document: Document): boolean {
  const copy = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const heading = [document.title, ...Array.from(document.querySelectorAll('h1, h2'), copy)].join(
    ' ',
  );
  if (
    /just a moment|verify (?:to continue|(?:that )?you(?:'re| are) (?:a )?human)|attention required|pardon our interruption|are you a (?:human|robot)/i.test(
      heading,
    )
  )
    return true;
  const body = document.body.cloneNode(true) as HTMLElement;
  for (const node of body.querySelectorAll('script, style, template')) node.remove();
  const text = copy(body);
  const instruction =
    /checking (?:if )?(?:the |your )?(?:site )?connection is secure|enable javascript and cookies to continue|confirm (?:that )?you(?:'re| are) a human|(?:please )?verify (?:that )?you are (?:a )?human|press (?:and|&) hold to confirm|please enable js and disable any ad blocker|unusual traffic from your computer network/i;
  if (text.length < 5000 && instruction.test(text)) return true;
  const vendor = document.querySelector(
    '[id^="cf-chl"], #challenge-form, #px-captcha, [id^="datadome"], script[src*="captcha-delivery.com/"], script[src*="geo.captcha-delivery.com/"]',
  );
  return Boolean(
    vendor &&
      text.length < 5000 &&
      /verify|captcha|blocked|access denied|security check/i.test(text),
  );
}
