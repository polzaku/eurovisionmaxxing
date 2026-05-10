import { describe, it, expect } from "vitest";

import {
  countPreservedPreviews,
  eventToApiPath,
  mergeWithExisting,
  parseEventArg,
  parseExistingJson,
  parseYearArg,
  validateApiBody,
  type ApiRow,
  type WrapperJson,
} from "./fetch-contestants-helpers";

describe("eventToApiPath", () => {
  it("maps each internal slug to the EurovisionAPI path segment", () => {
    expect(eventToApiPath("semi1")).toBe("first-semi-final");
    expect(eventToApiPath("semi2")).toBe("second-semi-final");
    expect(eventToApiPath("final")).toBe("grand-final");
  });
});

describe("parseEventArg", () => {
  it("accepts the three canonical event slugs", () => {
    expect(parseEventArg("semi1")).toBe("semi1");
    expect(parseEventArg("semi2")).toBe("semi2");
    expect(parseEventArg("final")).toBe("final");
  });
  it("rejects API-style names and arbitrary strings", () => {
    expect(parseEventArg("first-semi-final")).toBeNull();
    expect(parseEventArg("Final")).toBeNull();
    expect(parseEventArg("")).toBeNull();
    expect(parseEventArg("semi3")).toBeNull();
  });
});

describe("parseYearArg", () => {
  it("accepts plausible 4-digit years", () => {
    expect(parseYearArg("2026")).toBe(2026);
    expect(parseYearArg("2000")).toBe(2000);
    expect(parseYearArg("9999")).toBe(9999);
  });
  it("rejects below the Eurovision floor and non-numeric input", () => {
    expect(parseYearArg("1955")).toBeNull();
    expect(parseYearArg("abc")).toBeNull();
    expect(parseYearArg("")).toBeNull();
    expect(parseYearArg("2026.5")).toBeNull();
    expect(parseYearArg("2026a")).toBeNull();
  });
});

describe("validateApiBody", () => {
  const goodRow = {
    country: "Sweden",
    artist: "Loreen",
    song: "Tattoo",
    runningOrder: 9,
  };

  it("accepts a well-shaped array of canonical rows", () => {
    const result = validateApiBody([goodRow]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(1);
  });

  it("rejects non-array bodies", () => {
    const result = validateApiBody({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/expected JSON array/i);
  });

  it("rejects empty arrays with an allocation-draw hint", () => {
    const result = validateApiBody([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/allocation draw/i);
  });

  it("collects all malformed-row errors before failing", () => {
    const result = validateApiBody([
      goodRow,
      { country: "", artist: "x", song: "y", runningOrder: 1 },
      { country: "Italy", artist: "Mahmood", song: "Tuta Gold" }, // missing runningOrder
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toMatch(/row 1/);
      expect(result.errors[1]).toMatch(/row 2/);
    }
  });

  it("strips extra unknown fields from valid rows", () => {
    const result = validateApiBody([{ ...goodRow, artistPreviewUrl: "abc" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]).toEqual(goodRow);
      expect((result.rows[0] as unknown as Record<string, unknown>).artistPreviewUrl).toBeUndefined();
    }
  });
});

describe("parseExistingJson", () => {
  it("returns null on invalid JSON", () => {
    expect(parseExistingJson("{not json")).toBeNull();
  });

  it("parses the legacy flat-array shape into wrapper with no broadcast time", () => {
    const raw = JSON.stringify([
      { country: "Sweden", artist: "Loreen", song: "Tattoo", runningOrder: 9 },
    ]);
    const parsed = parseExistingJson(raw);
    expect(parsed).toEqual({
      contestants: [
        { country: "Sweden", artist: "Loreen", song: "Tattoo", runningOrder: 9 },
      ],
    });
    expect(parsed?.broadcastStartUtc).toBeUndefined();
  });

  it("parses the wrapper shape with broadcastStartUtc + artistPreviewUrl preserved", () => {
    const raw = JSON.stringify({
      broadcastStartUtc: "2026-05-16T19:00:00Z",
      contestants: [
        {
          country: "Sweden",
          artist: "Loreen",
          song: "Tattoo",
          runningOrder: 9,
          artistPreviewUrl: "https://youtu.be/abc",
        },
      ],
    });
    expect(parseExistingJson(raw)).toEqual({
      broadcastStartUtc: "2026-05-16T19:00:00Z",
      contestants: [
        {
          country: "Sweden",
          artist: "Loreen",
          song: "Tattoo",
          runningOrder: 9,
          artistPreviewUrl: "https://youtu.be/abc",
        },
      ],
    });
  });

  it("returns null when the wrapper has no contestants array", () => {
    const raw = JSON.stringify({ broadcastStartUtc: "2026-05-16T19:00:00Z" });
    expect(parseExistingJson(raw)).toBeNull();
  });

  it("drops malformed rows but keeps valid ones", () => {
    const raw = JSON.stringify({
      contestants: [
        { country: "Sweden", artist: "Loreen", song: "Tattoo", runningOrder: 9 },
        { country: "", artist: "x", song: "y", runningOrder: 1 },
        "not-an-object",
      ],
    });
    const parsed = parseExistingJson(raw);
    expect(parsed?.contestants).toHaveLength(1);
    expect(parsed?.contestants[0].country).toBe("Sweden");
  });
});

describe("mergeWithExisting", () => {
  const upstream: ApiRow[] = [
    { country: "Sweden", artist: "Loreen", song: "Tattoo", runningOrder: 9 },
    { country: "Italy", artist: "Mahmood", song: "Tuta Gold", runningOrder: 3 },
  ];

  it("sorts contestants by runningOrder ascending", () => {
    const merged = mergeWithExisting(upstream, null);
    expect(merged.contestants.map((c) => c.country)).toEqual([
      "Italy",
      "Sweden",
    ]);
  });

  it("preserves broadcastStartUtc from existing", () => {
    const existing: WrapperJson = {
      broadcastStartUtc: "2026-05-16T19:00:00Z",
      contestants: [],
    };
    const merged = mergeWithExisting(upstream, existing);
    expect(merged.broadcastStartUtc).toBe("2026-05-16T19:00:00Z");
  });

  it("preserves per-row artistPreviewUrl by country (case-insensitive)", () => {
    const existing: WrapperJson = {
      contestants: [
        {
          country: "sweden", // lowercase intentionally
          artist: "Loreen",
          song: "Tattoo",
          runningOrder: 9,
          artistPreviewUrl: "https://youtu.be/preserved",
        },
      ],
    };
    const merged = mergeWithExisting(upstream, existing);
    const sweden = merged.contestants.find((c) => c.country === "Sweden");
    expect(sweden?.artistPreviewUrl).toBe("https://youtu.be/preserved");
  });

  it("does not invent artistPreviewUrl for rows without a preserved value", () => {
    const existing: WrapperJson = {
      contestants: [
        {
          country: "Sweden",
          artist: "Loreen",
          song: "Tattoo",
          runningOrder: 9,
          artistPreviewUrl: "https://youtu.be/preserved",
        },
      ],
    };
    const merged = mergeWithExisting(upstream, existing);
    const italy = merged.contestants.find((c) => c.country === "Italy");
    expect(italy?.artistPreviewUrl).toBeUndefined();
  });

  it("returns empty wrapper when given empty upstream + null existing", () => {
    expect(mergeWithExisting([], null)).toEqual({ contestants: [] });
  });

  it("drops preserved previews whose country dropped from the upstream list (withdrawal)", () => {
    const existing: WrapperJson = {
      contestants: [
        {
          country: "Russia",
          artist: "Dima Bilan",
          song: "Believe",
          runningOrder: 12,
          artistPreviewUrl: "https://youtu.be/dropped",
        },
      ],
    };
    const merged = mergeWithExisting(upstream, existing);
    expect(merged.contestants.find((c) => c.country === "Russia")).toBeUndefined();
  });
});

describe("countPreservedPreviews", () => {
  it("counts rows with artistPreviewUrl set", () => {
    const wrapper: WrapperJson = {
      contestants: [
        { country: "A", artist: "a", song: "a", runningOrder: 1, artistPreviewUrl: "x" },
        { country: "B", artist: "b", song: "b", runningOrder: 2 },
        { country: "C", artist: "c", song: "c", runningOrder: 3, artistPreviewUrl: "y" },
      ],
    };
    expect(countPreservedPreviews(wrapper)).toBe(2);
  });
});
