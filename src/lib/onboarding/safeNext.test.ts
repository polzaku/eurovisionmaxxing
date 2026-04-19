import { describe, it, expect } from "vitest";
import { sanitizeNextPath } from "@/lib/onboarding/safeNext";

describe("sanitizeNextPath", () => {
  describe("accepts valid same-origin paths", () => {
    const valid = [
      "/",
      "/create",
      "/join",
      "/room/abc",
      "/create?year=2026",
      "/room/abc#results",
      "/a/b/c",
    ];
    for (const p of valid) {
      it(`accepts ${JSON.stringify(p)}`, () => {
        expect(sanitizeNextPath(p)).toBe(p);
      });
    }
  });

  describe("rejects dangerous or invalid input", () => {
    const invalid: Array<[string, unknown]> = [
      ["null", null],
      ["undefined", undefined],
      ["number", 42],
      ["empty string", ""],
      ["non-slash-start", "create"],
      ["protocol-relative //", "//evil.com"],
      ["protocol-relative /\\", "/\\evil.com"],
      ["absolute http", "http://evil.com"],
      ["absolute https", "https://evil.com"],
      ["javascript: scheme", "javascript:alert(1)"],
      ["data: scheme", "data:text/html,<script>"],
      ["control char in path", "/foo\x00bar"],
      ["newline in path", "/foo\nbar"],
      ["too long (>512)", "/" + "a".repeat(512)],
    ];
    for (const [label, raw] of invalid) {
      it(`rejects ${label} → "/"`, () => {
        expect(sanitizeNextPath(raw)).toBe("/");
      });
    }
  });
});
