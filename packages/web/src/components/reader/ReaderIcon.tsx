const paths = {
  sliders:
    'M3 6h4m6 0h8M3 18h9m6 0h3M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0M18 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  note: 'M5 3h14v13l-5 5H5zM14 16h5M14 16v5M8 8h8M8 12h6',
  page: 'M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8M14 3.5 18.5 8M14 3.5V8h4.5M9 12.5h6M9 16h4',
  refresh: 'M20 9a8 8 0 1 0 0 6M20 3v6h-6',
  close: 'M6 6l12 12M18 6 6 18',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  back: 'm14 5-7 7 7 7',
  clipboard: 'M9 5H5v16h14V5h-4M9 3h6v4H9z',
  terminal: 'M3 4h18v16H3zM7 9l3 3-3 3M13 15h4',
  copy: 'M9 7V3h12v12h-4M3 9h12v12H3z',
  edit: 'm16 3 5 5-12 12-6 1 1-6zM13 6l5 5',
  external: 'M14 3h7v7M21 3 10 14M10 5H3v16h16v-7',
  arrowUpRight: 'M7 17 17 7M8.5 7H17v8.5',
  trash: 'M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6',
  restore: 'M4 12a8 8 0 1 0 2-5M4 3v5h5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  // Rounded panel with a short inset rail, matching Shiori's sidebar glyph.
  sidebar:
    'M7.75 4.75h8.5a3 3 0 0 1 3 3v8.5a3 3 0 0 1-3 3h-8.5a3 3 0 0 1-3-3v-8.5a3 3 0 0 1 3-3ZM8.75 7.75v8.5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  moon: 'M20 15a9 9 0 0 1-11-11A9 9 0 1 0 20 15',
  library: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  bookmarkFilled: 'M6 3h12v18l-6-4-6 4z',
  search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  /** Eight-tooth gear with a center hole. */
  settings:
    'M10.43 5.18 10.51 2.62h2.98l.08 2.56A7 7 0 0 1 15.71 6.06l1.87-1.75 2.11 2.11-1.75 1.87A7 7 0 0 1 18.82 10.43l2.56.08v2.98l-2.56.08A7 7 0 0 1 17.94 15.71l1.75 1.87-2.11 2.11-1.87-1.75A7 7 0 0 1 13.57 18.82l-.08 2.56h-2.98l-.08-2.56A7 7 0 0 1 8.29 17.94l-1.87 1.75-2.11-2.11 1.75-1.87A7 7 0 0 1 5.18 13.57l-2.56-.08v-2.98l2.56-.08A7 7 0 0 1 6.06 8.29L4.31 6.42l2.11-2.11 1.87 1.75A7 7 0 0 1 10.43 5.18ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  logout: 'M10 3H4v18h6M16 7l5 5-5 5M21 12H9',
  hash: 'M10 5.5 8.5 18.5M15.5 5.5 14 18.5M6 9.75h12.5M5.5 14.25H18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'm5 12 4 4L19 6',
  right: 'm9 5 7 7-7 7',
} as const;

/** Original silo glyphs drawn on the shared 24-unit grid. */
export function ReaderIcon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      className="silo-reader-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'bookmarkFilled' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
