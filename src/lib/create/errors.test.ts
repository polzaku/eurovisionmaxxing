import { describe, it, expect } from "vitest";
import { mapCreateError } from "@/lib/create/errors";

describe("mapCreateError", () => {
  it.each([
    ["INVALID_YEAR", "That year isn't available. Try a different one."],
    ["INVALID_EVENT", "That event isn't available for this year."],
    ["INVALID_CATEGORIES", "Something's off with the category setup."],
    ["INVALID_CATEGORY", "One of the categories isn't valid."],
    ["INVALID_ANNOUNCEMENT_MODE", "Pick Live or Instant announcement mode."],
    ["INVALID_USER_ID", "Your session is invalid. Please re-onboard."],
    ["INVALID_BODY", "Something went wrong. Please try again."],
    ["INTERNAL_ERROR", "We hit a snag on our end. Please try again in a moment."],
    ["NETWORK", "We couldn't reach the server. Check your connection."],
  ])("maps %s to the expected message", (code, expected) => {
    expect(mapCreateError(code)).toBe(expected);
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(mapCreateError("SOMETHING_ELSE")).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("falls back when code is undefined", () => {
    expect(mapCreateError(undefined)).toBe(
      "Something went wrong. Please try again."
    );
  });
});
