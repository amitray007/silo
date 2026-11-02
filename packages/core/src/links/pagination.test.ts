import { describe, expect, it } from 'vitest';
import {
  decodeListCursor,
  decodeReaderCursor,
  decodeTrashCursor,
  encodeListCursor,
  encodeReaderCursor,
  encodeTrashCursor,
  InvalidCursorError,
} from './pagination.js';

const id = '00000000-0000-4000-8000-000000000001';
const cursors = [
  {
    kind: 'list',
    encode: (timestamp: string) => encodeListCursor(timestamp, id),
    decode: decodeListCursor,
    field: 'createdAt',
  },
  {
    kind: 'trash',
    encode: (timestamp: string) => encodeTrashCursor(timestamp, id),
    decode: decodeTrashCursor,
    field: 'deletedAt',
  },
  ...(['highlights', 'reading_positions'] as const).map((kind) => ({
    kind,
    encode: (timestamp: string) => encodeReaderCursor(kind, timestamp, id),
    decode: (cursor: string) => decodeReaderCursor(cursor, kind),
    field: 'timestamp',
  })),
];

describe.each(cursors)('$kind cursor timestamps', ({ encode, decode, field }) => {
  it.each([
    '2026-02-30T00:00:00Z',
    '2026-02-29 00:00:00.123456+00',
    '1900-02-29T00:00:00Z',
    '2026-04-31T23:59:59.999999-05:30',
    '2026-01-01T24:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-01-00T00:00:00Z',
    '2026-01-01T00:00:00+24:00',
    '0000-01-01T00:00:00Z',
    'not a timestamp',
  ])('rejects an invalid instant: %s', (timestamp) => {
    expect(() => decode(encode(timestamp))).toThrow(InvalidCursorError);
  });

  it.each([
    '2026-02-28T00:00:00Z',
    '2024-02-29T23:59:59.123456Z',
    '2000-02-29 00:00:00.000001+00',
    '2026-01-01 00:00:00.999999+05:30',
    '2026-01-01T23:59:59.123456-0530',
    '2026-01-01 00:00:00+00',
    '2026-01-01T00:00:00.1Z',
  ])('preserves every timestamp digit: %s', (timestamp) => {
    expect(decode(encode(timestamp))).toMatchObject({ [field]: timestamp, id });
  });
});
