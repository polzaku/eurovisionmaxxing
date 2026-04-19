export type Rng = () => number;

const MIN_RANDOM_LEN = 4;
const MAX_ATTEMPTS = 32;

function randomSeed(rng: Rng, salt: number): string {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const raw = Math.floor(rng() * 0xffffffff) ^ (salt + i);
    const s = (raw >>> 0).toString(36);
    if (s.length >= MIN_RANDOM_LEN) return s;
  }
  return `s${salt.toString(36)}`;
}

export function generateCarouselSeeds(
  currentSeed: string,
  rng: Rng,
  count: number = 6,
): string[] {
  if (count < 4 || count > 6) {
    throw new RangeError(`count must be in [4, 6], got ${count}`);
  }
  const seeds: string[] = [currentSeed];
  const seen = new Set<string>([currentSeed]);
  let salt = 0;
  while (seeds.length < count) {
    const s = randomSeed(rng, salt++);
    if (!seen.has(s)) {
      seen.add(s);
      seeds.push(s);
    }
  }
  return seeds;
}
