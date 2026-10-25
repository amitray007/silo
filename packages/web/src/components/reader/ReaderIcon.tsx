const paths = {
  refresh: 'M13 6a5 5 0 1 0 .1 4M13 2v4H9',
  close: 'M4 4l8 8M12 4l-8 8',
  up: 'm4 10 4-4 4 4',
  down: 'm4 6 4 4 4-4',
  back: 'm9.5 3-5 5 5 5',
  copy: 'M6 5V2.5h7.5V10H11M2.5 6H10v7.5H2.5z',
  edit: 'm10.5 2.5 3 3-7.5 7.5-3.5.5.5-3.5zM9 4l3 3',
  external: 'M9 2.5h4.5V7M13.5 2.5 7 9M6.5 3.5h-4v10h10v-4',
  trash: 'M3 4.5h10M6 4.5V2.5h4v2M4 4.5l.5 9h7l.5-9M6.5 7v4M9.5 7v4',
  restore: 'M3 8a5 5 0 1 0 1.5-3.5M3 2.5v2.5h2.5',
  plus: 'M8 3v10M3 8h10',
  sidebar: 'M2.5 2.5h11v11h-11zM6 2.5v11',
  menu: 'M3 4h10M3 8h10M3 12h10',
  sun: 'M8 1v1M8 14v1M1 8h1M14 8h1M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  moon: 'M13 10a5.5 5.5 0 0 1-7-7A5.5 5.5 0 1 0 13 10',
} as const;

export function ReaderIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="silo-reader-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
