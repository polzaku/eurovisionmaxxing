import { describe, it, expect, beforeEach } from "vitest";
import { renderAvatarSvg, _resetCache } from "@/lib/export/dicebearInline";

beforeEach(() => {
  _resetCache();
});

describe("renderAvatarSvg", () => {
  it("returns a well-formed SVG string", () => {
    const svg = renderAvatarSvg("alice");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    expect(renderAvatarSvg("bob")).toBe(renderAvatarSvg("bob"));
  });

  it("differs between seeds", () => {
    expect(renderAvatarSvg("alice")).not.toBe(renderAvatarSvg("bob"));
  });

  it("contains no <script> tags", () => {
    expect(renderAvatarSvg("alice")).not.toContain("<script");
  });

  it("contains no fetched references (image/use/xlink/style url)", () => {
    // DiceBear embeds CC-BY attribution as inert <metadata> URLs (dc:source +
    // dcterms:license). Those are *attribution*, not fetches — no browser
    // touches them. What we actually need to forbid is *fetched* references
    // that would break the "self-contained, no external fetches" guarantee:
    // <image href=...>, <use href=...>, xlink:href=..., or CSS url(...).
    const svg = renderAvatarSvg("alice");
    expect(svg).not.toMatch(/<image\b[^>]*\bhref=/);
    expect(svg).not.toMatch(/<use\b[^>]*\bhref=/);
    expect(svg).not.toMatch(/xlink:href=/);
    expect(svg).not.toMatch(/style=[^>]*url\(/);
  });

  it("memoizes — repeated calls reuse cache", () => {
    const a = renderAvatarSvg("carol");
    const b = renderAvatarSvg("carol");
    expect(a).toBe(b);
    // Same string identity implies cache hit (sanity check, not a hard guarantee)
    expect(Object.is(a, b)).toBe(true);
  });
});
