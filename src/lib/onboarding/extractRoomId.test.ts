import { describe, it, expect } from "vitest";
import { extractRoomId } from "@/lib/onboarding/extractRoomId";

const VALID_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("extractRoomId", () => {
  it("returns the uuid when next is /room/<uuid>", () => {
    expect(extractRoomId(`/room/${VALID_UUID}`)).toBe(VALID_UUID);
  });

  it("returns null when next is /", () => {
    expect(extractRoomId("/")).toBeNull();
  });

  it("returns null when next is /room (no id)", () => {
    expect(extractRoomId("/room")).toBeNull();
  });

  it("returns null when next is /room/ (trailing slash, empty id)", () => {
    expect(extractRoomId("/room/")).toBeNull();
  });

  it("returns null when path has extra segments beyond /room/<id>", () => {
    expect(extractRoomId(`/room/${VALID_UUID}/present`)).toBeNull();
  });

  it("returns null when the id is not a uuid v4", () => {
    expect(extractRoomId("/room/not-a-uuid")).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(extractRoomId("/join")).toBeNull();
    expect(extractRoomId("/create")).toBeNull();
  });

  it("returns null for an empty string (defensive)", () => {
    expect(extractRoomId("")).toBeNull();
  });
});
