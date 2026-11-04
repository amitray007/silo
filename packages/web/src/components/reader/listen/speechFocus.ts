/** Who is speaking now. Starting any speech stops whoever held the speakers before. */
let holder: (() => void) | null = null;

/** Claim the speakers, stopping the previous holder. Returns a release that frees them if still held. */
export function takeSpeech(stop: () => void): () => void {
  const previous = holder;
  holder = stop;
  previous?.();
  return () => {
    if (holder === stop) holder = null;
  };
}
