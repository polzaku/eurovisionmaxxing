import { describe, it, expect } from "vitest";
import { EXPORT_STYLESHEET } from "@/lib/export/exportStylesheet";

describe("EXPORT_STYLESHEET", () => {
  it("fits within the 4 KB budget", () => {
    expect(Buffer.byteLength(EXPORT_STYLESHEET, "utf8")).toBeLessThanOrEqual(
      4 * 1024,
    );
  });

  it("contains a @media print block", () => {
    expect(EXPORT_STYLESHEET).toMatch(/@media\s+print/);
  });

  it("uses no external url() references", () => {
    expect(EXPORT_STYLESHEET).not.toMatch(/url\(/);
  });

  it("uses no http(s) references", () => {
    expect(EXPORT_STYLESHEET).not.toMatch(/https?:\/\//);
  });

  it("declares the chip and chip--missed classes", () => {
    expect(EXPORT_STYLESHEET).toContain(".chip");
    expect(EXPORT_STYLESHEET).toContain(".chip--missed");
  });

  it("declares the leaderboard table styling", () => {
    expect(EXPORT_STYLESHEET).toMatch(/\.leaderboard\s+table/);
  });
});
