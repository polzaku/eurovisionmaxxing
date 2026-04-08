/**
 * DiceBear fun-emoji avatar URL generator.
 */
export function getAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`;
}
