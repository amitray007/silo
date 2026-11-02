import type { HighlightColor } from '../../../lib/highlights';
import { ColorDots } from './ColorDots';

/**
 * The Highlight tool's sheet: the colour new highlights start with. While it is open, selecting
 * text highlights it at once (the dock passes the colour as `autoColor`).
 */
export function HighlightSheet({
  color,
  setColor,
}: {
  color: HighlightColor;
  setColor: (color: HighlightColor) => void;
}) {
  return (
    <div className="silo-type-sheet-body">
      <div className="silo-reader-settings-row">
        <span>Colour</span>
        <ColorDots value={color} onPick={setColor} label="Highlight colour" />
      </div>
    </div>
  );
}
