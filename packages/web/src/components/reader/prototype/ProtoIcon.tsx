const paths = {
  pencil: 'm16 3 5 5-12 12-6 1 1-6zM13 6l5 5',
  highlighter: 'm13.5 4.5 6 6-8.5 8.5H5.5v-6zM4 21h7',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z',
  notes: 'M5 3h14v13l-5 5H5zM14 16h5M14 16v5M8 8h8M8 12h6',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8.5 5v14M15.5 5v14',
  prev: 'M6 5v14M19 5l-9 7 9 7z',
  next: 'M18 5v14M5 5l9 7-9 7z',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  chevronLeft: 'm14 5-7 7 7 7',
  chevronRight: 'm9 5 7 7-7 7',
  trash: 'M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6',
  stop: 'M7 7h10v10H7z',
  quote: 'M5 17c0-4 1-7 4-9M13 17c0-4 1-7 4-9M5 17h4v-4H5zM13 17h4v-4h-4z',
  copy: 'M9 7V3h12v12h-4M3 9h12v12H3z',
  search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevronDown: 'm6 9 6 6 6-6',
} as const;

export type ProtoIconName = keyof typeof paths;

const filled = new Set<ProtoIconName>(['play', 'prev', 'next', 'stop']);

export function ProtoIcon({ name, size = 18 }: { name: ProtoIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled.has(name) ? 'currentColor' : 'none'}
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
