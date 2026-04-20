import { describe, it, expect } from "vitest";
import { mapJoinError } from "@/lib/join/errors";

describe("mapJoinError", () => {
  it.each([
    ["ROOM_NOT_FOUND", "No room matches that PIN. Check with the host."],
    ["ROOM_NOT_JOINABLE", "This room isn't accepting new members right now."],
    ["INVALID_PIN", "That doesn't look like a valid room PIN."],
    ["INVALID_USER_ID", "Your session is invalid. Please re-onboard."],
    ["INVALID_BODY", "Something went wrong. Please try again."],
    ["INTERNAL_ERROR", "Something went wrong. Please try again."],
  ])("maps %s to the expected message", (code, expected) => {
    expect(mapJoinError(code)).toBe(expected);
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(mapJoinError("SOMETHING_ELSE")).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("falls back when code is undefined", () => {
    expect(mapJoinError(undefined)).toBe(
      "Something went wrong. Please try again."
    );
  });
});
