import { describe, it, expect } from "vitest";
import { escapeHtml } from "@/lib/export/escapeHtml";

describe("escapeHtml", () => {
  it.each([
    ["<script>", "&lt;script&gt;"],
    ["A & B", "A &amp; B"],
    ['He said "hi"', "He said &quot;hi&quot;"],
    ["it's fine", "it&#39;s fine"],
    ["", ""],
    ["plain text", "plain text"],
    [
      "<img src=x onerror=alert(1)>",
      "&lt;img src=x onerror=alert(1)&gt;",
    ],
  ])("escapes %j → %j", (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it("preserves emoji", () => {
    expect(escapeHtml("🇸🇪 Sweden")).toBe("🇸🇪 Sweden");
  });

  it("escapes & before other entities (no double-encoding)", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});
