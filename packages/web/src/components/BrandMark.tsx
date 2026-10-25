/** The orange tile mark from the approved redesign, in both themes. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <span
      className="silo-brand-mark"
      style={{ width: size, height: size }}
      role="img"
      aria-label="silo"
    >
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </span>
  );
}
