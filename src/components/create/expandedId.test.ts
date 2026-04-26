import { describe, it, expect } from "vitest";
import { nextExpandedId } from "./expandedId";

describe("nextExpandedId", () => {
  it("opens a card when nothing is open", () => {
    expect(nextExpandedId(null, "classic")).toBe("classic");
  });

  it("collapses the open card when its own id is clicked again", () => {
    expect(nextExpandedId("classic", "classic")).toBeNull();
  });

  it("switches to a different card when another id is clicked", () => {
    expect(nextExpandedId("classic", "spectacle")).toBe("spectacle");
  });

  it("is generic — works with arbitrary string-tag types", () => {
    type Mode = "live" | "instant";
    const result: Mode | null = nextExpandedId<Mode>(null, "live");
    expect(result).toBe("live");
  });
});
