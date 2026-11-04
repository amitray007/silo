// Vendored from fun-isometric (github.com/kelvinkn17/skills @ 7c8a7526306e09855c0d4f66130cbaa87422cb8d)
// by Kelvin Adithya. MIT License, Copyright (c) Kelvin Adithya. Silo keeps it near-verbatim; edit only to satisfy lint.
// Silo empty-state stickers: the six drawings approved in the mockup round (docs/methods/empty-stickers.md).

import type { Icon, Layer, Motion, Shape, Vec } from './fun';
import { arc, ellipse, line, onFace, pill, poly, rect, ring, spark, VIEWS } from './fun';
import {
  hop,
  impact,
  jolt,
  latch,
  look,
  SNAP,
  slide,
  sparkle,
  springTurn,
  toss,
  tossLag,
  tossLag2,
  twist,
  wobble,
} from './motions';

// colours are palette slots, so draw(..., palette) or play(..., { palette }) recolours the whole set
const LINE = 5;
// the house view: faces turned 18 degrees in their plane and leaned back 36, sides falling down left
const { tilt: FACE, extrude: EXT } = VIEWS.right;

// a white sparkle riding a parent, popped by whatever motion it is given
const glow = (
  parent: string,
  p: Vec,
  r: number,
  m: Motion | ReadonlyArray<Motion>,
  extra: { ip?: number; op?: number } = {},
): Layer => ({
  parent,
  a: p,
  p,
  m,
  ...extra,
  shapes: [{ d: spark(p[0], p[1], r), fill: 'white' }],
});

export const folder: Icon = {
  name: 'folder',
  frames: 180,
  line: LINE,
  extrude: EXT,
  layers: [
    {
      parent: 'body',
      shapes: [
        {
          d: poly(
            [
              [-130, -100],
              [-56, -100],
              [-34, -76],
              [130, -76],
              [130, 92],
              [-130, 92],
            ],
            [18, 8, 8, 18, 18, 18],
          ),
          fill: 'main',
          depth: 1,
        },
      ],
    },
    {
      parent: 'body',
      a: [-108, 50],
      p: [-108, 50],
      m: tossLag2,
      shapes: [
        { d: rect(-104, -136, 206, 192, 12), fill: 'white', depth: 0.3 },
        { d: line([-78, -118], [8, -118]) },
      ],
    },
    {
      parent: 'body',
      a: [-116, 52],
      p: [-116, 52],
      m: tossLag,
      shapes: [{ d: rect(-116, -104, 226, 164, 12), fill: 'ok', depth: 0.3 }],
    },
    {
      id: 'body',
      a: [-130, 20],
      p: [126, 294],
      tilt: FACE,
      m: toss,
      shapes: [
        { d: rect(-130, -46, 260, 138, 18), fill: 'deep', depth: 1 },
        { d: pill(-46, -12, 92, 28), fill: 'white', depth: 0.3 },
      ],
    },
  ],
};

export const search: Icon = {
  name: 'search',
  frames: 180,
  line: LINE,
  extrude: EXT,
  layers: [
    { id: 'lens', p: [222, 226], m: twist, shapes: [] },
    {
      parent: 'lens',
      tilt: [-20, 28],
      shapes: [
        {
          d: poly(
            [
              [54, 90],
              [90, 54],
              [178, 142],
              [142, 178],
            ],
            [0, 0, 24, 24],
          ),
          fill: 'hot',
          depth: 1,
        },
        {
          d: poly(
            [
              [48, 93],
              [93, 48],
              [113, 68],
              [68, 113],
            ],
            6,
          ),
          fill: 'grey',
          depth: 1,
        },
        { d: ellipse(0, 0, 80), fill: 'white' },
        { d: ring(0, 0, 104, 78), fill: 'main', depth: 1 },
        { d: arc(0, 0, 56, 200, 255) },
      ],
    },
    glow('lens', [30, -26], 22, sparkle(20)),
    glow('lens', [-32, 30], 14, sparkle(96)),
  ],
};

const BUBBLE = poly(
  [
    [-132, -96],
    [132, -96],
    [132, 74],
    [-36, 74],
    [-96, 120],
    [-80, 74],
    [-132, 74],
  ],
  [30, 30, 30, 4, 6, 4, 30],
);
const BOT: Vec = [-16, 30];
// it rocks on the bubble's bottom edge, placed so the face sits where it always did
const ROCK = onFace(BOT, [0, 74]);

export const chat: Icon = {
  name: 'chat',
  frames: 180,
  line: LINE,
  extrude: EXT,
  layers: [
    { id: 'bot', a: ROCK, p: [252 + ROCK[0], 216 + ROCK[1]], m: wobble, shapes: [] },
    {
      id: 'face',
      parent: 'bot',
      tilt: BOT,
      shapes: [
        { d: pill(-8, -150, 16, 60), fill: 'grey', depth: 0.5 },
        { d: ellipse(0, -152, 20), fill: 'gold', depth: 0.6 },
        { d: BUBBLE, fill: 'main', depth: 1 },
        { d: rect(-104, -70, 208, 118, 26), fill: 'tint' },
        { d: arc(0, 4, 30, 25, 155) },
      ],
    },
    { id: 'eyeL', parent: 'face', shapes: [{ d: ellipse(-46, -20, 26, 30), fill: 'white' }] },
    { id: 'eyeR', parent: 'face', shapes: [{ d: ellipse(46, -20, 26, 30), fill: 'white' }] },
    {
      parent: 'face',
      clip: 'eyeL',
      m: { ...look, k: 1.6 },
      shapes: [{ d: ellipse(-40, -14, 15), fill: 'ink', line: false }],
    },
    {
      parent: 'face',
      clip: 'eyeR',
      m: { ...look, k: 1.6 },
      shapes: [{ d: ellipse(52, -14, 15), fill: 'ink', line: false }],
    },
    glow('bot', [150, -118], 26, sparkle(16)),
    glow('bot', [-156, -60], 16, sparkle(92)),
  ],
};

// the flag springs up when the post comes, the letter slides out of the door, both home before the loop
const BOX: Vec = FACE;
export const mailbox: Icon = {
  name: 'mailbox',
  frames: 180,
  line: LINE,
  extrude: EXT,
  layers: [
    { id: 'mail', a: [0, 150], p: [250, 392], m: jolt([-4, 10]), shapes: [] },
    {
      parent: 'mail',
      tilt: BOX,
      shapes: [{ d: rect(-18, 40, 36, 150, 6), fill: 'grey', depth: 0.8 }],
    },
    {
      parent: 'box',
      a: [70, 0],
      p: [70, 0],
      m: slide([56, 0], 24, 72, 40),
      shapes: [
        { d: rect(30, -40, 96, 62, 6), fill: 'white', depth: 0.25 },
        { d: line([44, -24], [78, -6], [112, -24]) },
      ],
    },
    {
      id: 'box',
      parent: 'mail',
      tilt: BOX,
      shapes: [
        {
          d: poly(
            [
              [-136, -96],
              [136, -96],
              [136, 56],
              [-136, 56],
            ],
            [72, 72, 10, 10],
          ),
          fill: 'deep',
          depth: 1,
        },
        {
          d: poly(
            [
              [96, -96],
              [136, -96],
              [136, 56],
              [96, 56],
            ],
            [0, 72, 10, 0],
          ),
          fill: 'main',
          depth: 1,
        },
      ],
    },
    {
      parent: 'box',
      a: [-60, -10],
      p: [-60, -10],
      r: 84,
      m: { r: [...springTurn(-84, 18), [128, -84, SNAP], [168, 0]] },
      shapes: [
        { d: rect(-68, -130, 16, 124, 4), fill: 'grey', depth: 0.5 },
        { d: rect(-68, -130, 70, 44, 6), fill: 'hot', depth: 0.5 },
      ],
    },
  ],
};

// --- Silo empty states: drawn new for the mockup ---

// The lid slams shut (latch) and the bin takes the hit (impact), like the gift.
export const trash: Icon = {
  name: 'trash',
  frames: 180,
  still: 125, // lid shut and held
  line: LINE,
  extrude: EXT,
  layers: [
    { id: 'bin', p: [250, 262], m: impact([2, 14]), shapes: [] },
    {
      id: 'crate',
      parent: 'bin',
      tilt: FACE,
      shapes: [
        {
          d: poly(
            [
              [-100, -26],
              [100, -26],
              [82, 150],
              [-82, 150],
            ],
            [4, 4, 22, 22],
          ),
          fill: 'main',
          depth: 1,
        },
        ...[-1, 0, 1].map(
          (i): Shape => ({ d: pill(i * 44 - 7, 8, 14, 112), fill: 'tint', depth: 0.2 }),
        ),
      ],
    },
    {
      parent: 'crate',
      p: [0, -44],
      m: latch([0, 44]),
      shapes: [
        { d: rect(-34, -86, 68, 34, 12), fill: 'deep', depth: 0.6 },
        { d: rect(-124, -58, 248, 40, 12), fill: 'deep', depth: 0.9 },
      ],
    },
    glow('bin', [128, -116], 26, { ...sparkle(0), at: 28 }),
    glow('bin', [-132, -60], 16, { ...sparkle(0), at: 40 }),
  ],
};

// A luggage tag with a hash, hopping on its point like the pin
const TAG = poly(
  [
    [-124, -88],
    [34, -88],
    [128, 0],
    [34, 88],
    [-124, 88],
  ],
  [26, 10, 10, 10, 26],
);
const HASH = (dx: number): ReadonlyArray<Shape> => [
  { d: line([dx - 14, -52], [dx - 30, 52]), line: 13 },
  { d: line([dx + 30, -52], [dx + 14, 52]), line: 13 },
  { d: line([dx - 50, -16], [dx + 52, -16]), line: 13 },
  { d: line([dx - 56, 22], [dx + 46, 22]), line: 13 },
];
export const tag: Icon = {
  name: 'tag',
  frames: 180,
  line: LINE,
  extrude: EXT,
  layers: [
    { id: 'drop', a: [0, 100], p: [250, 340], m: { ...hop, at: 14 }, shapes: [] },
    {
      parent: 'drop',
      tilt: FACE,
      shapes: [
        { d: TAG, fill: 'main', depth: 1 },
        { d: ellipse(-92, 0, 22), fill: 'white', depth: 0.3 },
        ...HASH(14),
      ],
    },
    glow('drop', [128, -128], 26, { ...sparkle(0), at: 50 }),
    glow('drop', [-132, -84], 16, { ...sparkle(0), at: 100 }),
  ],
};
