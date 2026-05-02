import { describe, it, expect } from "vitest";
import { lateJoinerVisibility } from "./lateJoinerVisibility";

describe("lateJoinerVisibility", () => {
  it("returns 'hidden' when dismissed", () => {
    expect(
      lateJoinerVisibility({
        status: "voting",
        lobbySeen: false,
        dismissed: true,
      }),
    ).toBe("hidden");
  });

  it("returns 'hidden' when the user previously saw the lobby (was not late)", () => {
    expect(
      lateJoinerVisibility({
        status: "voting",
        lobbySeen: true,
        dismissed: false,
      }),
    ).toBe("hidden");
  });

  it("returns 'show' when status is voting and lobby was never seen", () => {
    expect(
      lateJoinerVisibility({
        status: "voting",
        lobbySeen: false,
        dismissed: false,
      }),
    ).toBe("show");
  });

  it("returns 'show' during voting_ending too — the user still benefits from orientation", () => {
    expect(
      lateJoinerVisibility({
        status: "voting_ending",
        lobbySeen: false,
        dismissed: false,
      }),
    ).toBe("show");
  });

  it.each(["lobby", "scoring", "announcing", "done"] as const)(
    "returns 'hidden' when status=%s (card belongs to voting/voting_ending only)",
    (status) => {
      expect(
        lateJoinerVisibility({ status, lobbySeen: false, dismissed: false }),
      ).toBe("hidden");
    },
  );

  it("dismissed wins over a missing lobby-seen flag", () => {
    expect(
      lateJoinerVisibility({
        status: "voting",
        lobbySeen: false,
        dismissed: true,
      }),
    ).toBe("hidden");
  });
});
