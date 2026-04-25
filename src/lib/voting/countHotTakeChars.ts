const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function countHotTakeChars(text: string): number {
  if (text === "") return 0;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const { segment } of segmenter.segment(text)) {
    count += EMOJI_RE.test(segment) ? 2 : 1;
  }
  return count;
}
