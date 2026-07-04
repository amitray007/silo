/**
 * The brand "grain" dot — amber radial gradient. Brand mark only, never chrome.
 * Reuses base.css's `.silo-grain-dot` (gradient defined once, there) and adds
 * only the size override here, so the gradient never lives in two places.
 */
export function GrainDot({ size = 15 }: { size?: number }) {
  return <span className="silo-grain-dot" style={{ width: size, height: size }} />;
}
