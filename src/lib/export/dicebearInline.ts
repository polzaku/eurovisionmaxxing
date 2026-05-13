import { createAvatar } from "@dicebear/core";
import { funEmoji } from "@dicebear/collection";

const cache = new Map<string, string>();

/**
 * Server-side renderer for inline DiceBear fun-emoji avatars. Used by the
 * R5 §12.3 HTML export to embed avatars without runtime fetches to
 * api.dicebear.com.
 *
 * Memoized per-process. For a single export the cache is bounded by the
 * room's member count (~15-50 unique seeds). The cache is intentionally
 * unbounded — the export route is short-lived so growth is negligible;
 * call _resetCache from tests when isolation is needed.
 */
export function renderAvatarSvg(seed: string): string {
  const hit = cache.get(seed);
  if (hit !== undefined) return hit;
  const svg = createAvatar(funEmoji, {
    seed,
    size: 48,
    backgroundColor: ["transparent"],
  }).toString();
  cache.set(seed, svg);
  return svg;
}

/** Exposed for test isolation only. Not part of the public API. */
export function _resetCache(): void {
  cache.clear();
}
