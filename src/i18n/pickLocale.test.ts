import { describe, it, expect } from "vitest";
import { pickLocale } from "@/i18n/pickLocale";

describe("pickLocale", () => {
  it("returns 'en' when header is null or empty", () => {
    expect(pickLocale(null)).toBe("en");
    expect(pickLocale("")).toBe("en");
    expect(pickLocale("   ")).toBe("en");
  });

  it("matches an exact supported subtag", () => {
    expect(pickLocale("es")).toBe("es");
    expect(pickLocale("uk")).toBe("uk");
    expect(pickLocale("fr")).toBe("fr");
    expect(pickLocale("de")).toBe("de");
  });

  it("matches by primary subtag (es-AR → es)", () => {
    expect(pickLocale("es-AR")).toBe("es");
    expect(pickLocale("es-MX,en;q=0.5")).toBe("es");
    expect(pickLocale("uk-UA")).toBe("uk");
  });

  it("walks the prioritized list and picks the first supported", () => {
    expect(pickLocale("pt-BR,en;q=0.5")).toBe("en");
    expect(pickLocale("zh-CN,fr;q=0.7,en;q=0.3")).toBe("fr");
    expect(pickLocale("ja,ko;q=0.8,uk;q=0.5")).toBe("uk");
  });

  it("falls back to 'en' when nothing matches", () => {
    expect(pickLocale("zh-CN")).toBe("en");
    expect(pickLocale("ja,ko")).toBe("en");
  });

  it("ignores malformed entries and continues", () => {
    expect(pickLocale("garbage,,;;,fr")).toBe("fr");
    expect(pickLocale("totally-not-valid")).toBe("en");
  });

  it("is case-insensitive on the primary subtag", () => {
    expect(pickLocale("ES-mx")).toBe("es");
    expect(pickLocale("FR")).toBe("fr");
  });
});
