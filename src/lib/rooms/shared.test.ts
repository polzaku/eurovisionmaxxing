import { describe, it, expect } from "vitest";
import { mapRoom } from "@/lib/rooms/shared";
import type { Database } from "@/types/database";

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

describe("mapRoom", () => {
  it("maps a full rooms row to the domain Room shape", () => {
    const row: RoomRow = {
      id: "room-uuid",
      pin: "AAAAAA",
      year: 2026,
      event: "final",
      categories: [{ name: "Vocals", weight: 1 }],
      owner_user_id: "owner-uuid",
      status: "lobby",
      announcement_mode: "instant",
      announcement_order: null,
      announcing_user_id: null,
      current_announce_idx: 0,
      delegate_user_id: null,
      now_performing_id: null,
      allow_now_performing: false,
      created_at: "2026-04-19T12:00:00Z",
    };
    expect(mapRoom(row)).toEqual({
      id: "room-uuid",
      pin: "AAAAAA",
      year: 2026,
      event: "final",
      categories: [{ name: "Vocals", weight: 1 }],
      ownerUserId: "owner-uuid",
      status: "lobby",
      announcementMode: "instant",
      announcementOrder: null,
      announcingUserId: null,
      currentAnnounceIdx: 0,
      nowPerformingId: null,
      allowNowPerforming: false,
      createdAt: "2026-04-19T12:00:00Z",
    });
  });

  it("passes through nullable announcement fields unchanged", () => {
    const row: RoomRow = {
      id: "r",
      pin: "BBBBBB",
      year: 2025,
      event: "semi1",
      categories: [],
      owner_user_id: "u",
      status: "announcing",
      announcement_mode: "live",
      announcement_order: ["u-1", "u-2"],
      announcing_user_id: "u-1",
      current_announce_idx: 3,
      delegate_user_id: null,
      now_performing_id: "2025-ua",
      allow_now_performing: true,
      created_at: "2026-04-19T12:00:00Z",
    };
    const mapped = mapRoom(row);
    expect(mapped.announcementOrder).toEqual(["u-1", "u-2"]);
    expect(mapped.announcingUserId).toBe("u-1");
    expect(mapped.currentAnnounceIdx).toBe(3);
    expect(mapped.nowPerformingId).toBe("2025-ua");
    expect(mapped.allowNowPerforming).toBe(true);
  });
});
