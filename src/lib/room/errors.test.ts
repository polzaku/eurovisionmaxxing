import { describe, it, expect } from "vitest";
import { mapRoomError } from "@/lib/room/errors";

describe("mapRoomError", () => {
  it.each([
    ["ROOM_NOT_FOUND", "This room doesn't exist or has been removed."],
    ["FORBIDDEN", "Only the host can do that."],
    ["INVALID_TRANSITION", "That action isn't available right now."],
    ["INVALID_USER_ID", "Your session is invalid. Please re-onboard."],
    ["ROOM_NOT_JOINABLE", "This room isn't accepting new members right now."],
    ["NETWORK", "We couldn't reach the server. Check your connection."],
  ])("maps %s to the expected message", (code, expected) => {
    expect(mapRoomError(code)).toBe(expected);
  });

  it("falls back for unknown codes", () => {
    expect(mapRoomError("SOMETHING_ELSE")).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("falls back when code is undefined", () => {
    expect(mapRoomError(undefined)).toBe(
      "Something went wrong. Please try again."
    );
  });
});
