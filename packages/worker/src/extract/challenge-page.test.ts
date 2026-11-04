import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { isChallengePage } from './challenge-page.js';

/** The pre-optimization implementation: walks every text node, then applies the 5000 cap. */
function legacyIsChallengePage(document: Document): boolean {
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
  const walker = document.createTreeWalker(document.body, 4, {
    acceptNode(node) {
      return node.parentElement?.closest('script, style, template') ? 2 : 1;
    },
  });
  let bodyText = '';
  while (walker.nextNode()) bodyText += walker.currentNode.textContent ?? '';
  const text = bodyText.replace(/\s+/g, ' ').trim();
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

function verdicts(html: string): { current: boolean; legacy: boolean } {
  const dom = new JSDOM(html);
  try {
    return {
      current: isChallengePage(dom.window.document),
      legacy: legacyIsChallengePage(dom.window.document),
    };
  } finally {
    dom.window.close();
  }
}

const instruction = 'unusual traffic from your computer network';

describe('isChallengePage', () => {
  it('flags a short verification screen and a vendor block page', () => {
    expect(verdicts(`<body><p>${instruction}</p></body>`)).toEqual({ current: true, legacy: true });
    expect(
      verdicts('<body><div id="px-captcha"></div><p>Access denied. Please verify.</p></body>'),
    ).toEqual({ current: true, legacy: true });
    expect(verdicts('<title>Just a moment...</title><body>x</body>')).toEqual({
      current: true,
      legacy: true,
    });
  });

  it('leaves articles, vendor markup without block copy, and hidden script copy alone', () => {
    expect(verdicts('<body><article><p>Plain prose.</p></article></body>')).toEqual({
      current: false,
      legacy: false,
    });
    expect(verdicts('<body><div id="px-captcha"></div><p>Plain prose.</p></body>')).toEqual({
      current: false,
      legacy: false,
    });
    expect(
      verdicts(`<body><p>Prose.</p><script>${instruction}</script><style>x{}</style></body>`),
    ).toEqual({ current: false, legacy: false });
  });

  it('agrees with the full walk on both sides of the 5000-character cap', () => {
    for (let length = 4_990; length <= 5_010; length++) {
      const filler = 'y'.repeat(length - instruction.length);
      const html = `<body><p>${instruction}</p><p>${filler}</p></body>`;
      const { current, legacy } = verdicts(html);
      expect(current, `length ${length}`).toBe(legacy);
      expect(current, `length ${length}`).toBe(length < 5_000);
    }
  });

  it('counts normalized text, not raw characters, toward the cap', () => {
    // Raw text is over 6000 characters, but collapsed whitespace leaves it under 5000.
    const spaced = `<p>${instruction}</p>${'<p>a \n\t   b</p>'.repeat(500)}`;
    expect(verdicts(`<body>${spaced}</body>`)).toEqual({ current: true, legacy: true });
    // Leading and trailing whitespace across node boundaries never counts either.
    const edges = `<p>   </p><p>${instruction}</p><p>${'y'.repeat(4_900)}</p><p>\n\n  </p>`;
    expect(verdicts(`<body>${edges}</body>`)).toEqual({ current: true, legacy: true });
  });

  it('stops counting at the cap for long pages, including ones that mention challenges', () => {
    const prose = `${'Bots are filtered with captcha and access denied pages. '.repeat(200)}${instruction}`;
    expect(verdicts(`<body><div id="px-captcha"></div><p>${prose}</p></body>`)).toEqual({
      current: false,
      legacy: false,
    });
    expect(verdicts(`<body>${'<p>word</p>'.repeat(5_000)}</body>`)).toEqual({
      current: false,
      legacy: false,
    });
  });

  it('matches the full walk on random node and whitespace splits around the cap', () => {
    let seed = 12_345;
    const next = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const fragments = ['a', 'bc', 'def', ' ', '  ', '\n', '\t \n', '\u00a0', 'x'.repeat(40), ' y '];
    for (let doc = 0; doc < 60; doc++) {
      const target = 4_900 + next(200);
      const nodes = [`<span>${instruction}</span>`];
      let length = instruction.length;
      while (length < target) {
        const fragment = fragments[next(fragments.length)] ?? 'a';
        nodes.push(`<span>${fragment}</span>`);
        length += fragment.length;
      }
      const { current, legacy } = verdicts(`<body>${nodes.join('')}</body>`);
      expect(current, `doc ${doc}`).toBe(legacy);
    }
  }, 30_000);

  it('matches the full walk across mixed structures', () => {
    const pages = [
      '<body></body>',
      '<body>   </body>',
      `<body><template>${instruction}</template><p>ok</p></body>`,
      `<body><div>${instruction.toUpperCase()}</div></body>`,
      '<body><div id="cf-chl-widget"></div><p>Please verify you are not blocked</p></body>',
      '<body><div id="datadome-x"></div><p>fine</p></body>',
      '<body><h1>Attention Required! | Cloudflare</h1></body>',
      `<body><p>${'é'.repeat(5_000)}</p></body>`,
      `<body><p>${' '.repeat(6_000)}${instruction}</p></body>`,
    ];
    for (const html of pages) {
      const { current, legacy } = verdicts(html);
      expect(current, html.slice(0, 80)).toBe(legacy);
    }
  });
});
