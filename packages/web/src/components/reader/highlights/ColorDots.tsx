import { HIGHLIGHT_COLORS, type HighlightColor } from '../../../lib/highlights';

/**
 * The five highlight colours as 18px dots. The selection stays put while a dot is pressed, so
 * choosing a colour never drops the text selection.
 */
export function ColorDots({
  value,
  onPick,
  label = 'Highlight colour',
}: {
  value: HighlightColor;
  onPick: (color: HighlightColor) => void;
  label?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of colour buttons, not a fieldset.
    <div className="silo-colors" role="group" aria-label={label}>
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="silo-color"
          data-color={color}
          aria-label={color}
          aria-pressed={value === color}
          title={color}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}
