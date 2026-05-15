// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import { readTvModeChoice, writeTvModeChoice } from "./tvModeChoice";

const ROOM_ID = "room-42";

describe("tvModeChoice", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("returns null when no choice has been written", () => {
    expect(readTvModeChoice(ROOM_ID)).toBeNull();
  });

  it("round-trips a 'tv' choice through sessionStorage", () => {
    writeTvModeChoice(ROOM_ID, "tv");
    expect(readTvModeChoice(ROOM_ID)).toBe("tv");
  });

  it("round-trips a 'skip' choice through sessionStorage", () => {
    writeTvModeChoice(ROOM_ID, "skip");
    expect(readTvModeChoice(ROOM_ID)).toBe("skip");
  });

  it("scopes choices per roomId — one room's choice doesn't leak into another", () => {
    writeTvModeChoice("room-a", "tv");
    writeTvModeChoice("room-b", "skip");
    expect(readTvModeChoice("room-a")).toBe("tv");
    expect(readTvModeChoice("room-b")).toBe("skip");
  });

  it("ignores corrupt sessionStorage values (defensive against manual edits)", () => {
    window.sessionStorage.setItem(`emx_tv_choice_${ROOM_ID}`, "garbage");
    expect(readTvModeChoice(ROOM_ID)).toBeNull();
  });
});
