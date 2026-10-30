/** Shared disclosure caret for sidebar sections. */
export function SectionCaret({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className="silo-section-caret"
      data-expanded={expanded}
      aria-hidden="true"
    >
      <path d="M1.5 3h7L5 7.5z" />
    </svg>
  );
}
