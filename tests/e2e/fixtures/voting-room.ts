/**
 * Fixture for the host-UX batch Playwright smoke (2026-05-14). Shape
 * mirrors the live `/api/rooms/{id}` payload for a room in `voting` /
 * `scoring` state.
 */

export const ROOM_ID = "33333333-3333-3333-3333-333333333333";
export const USER_ID = "44444444-4444-4444-4444-444444444444";

const CONTESTANTS = [
  {
    id: "2026-SE",
    year: 2026,
    event: "final",
    countryCode: "SE",
    country: "Sweden",
    artist: "Test Artist SE",
    song: "Test Song SE",
    flagEmoji: "🇸🇪",
    runningOrder: 1,
  },
  {
    id: "2026-UA",
    year: 2026,
    event: "final",
    countryCode: "UA",
    country: "Ukraine",
    artist: "Test Artist UA",
    song: "Test Song UA",
    flagEmoji: "🇺🇦",
    runningOrder: 2,
  },
];

function buildPayload(status: string, announcementMode: "live" | "instant") {
  return {
    room: {
      id: ROOM_ID,
      pin: "ABCDEF",
      status,
      ownerUserId: USER_ID,
      categories: [{ name: "Vocals", weight: 1 }],
      announcementMode,
      announcementOrder: null,
      announcingUserId: null,
      currentAnnounceIdx: null,
      votingEndsAt: null,
    },
    memberships: [
      {
        userId: USER_ID,
        displayName: "Alice",
        avatarSeed: "alice",
      },
    ],
    contestants: CONTESTANTS,
    votes: [],
    broadcastStartUtc: null,
  };
}

export const VOTING_ROOM_LIVE = buildPayload("voting", "live");
export const SCORING_ROOM_LIVE = buildPayload("scoring", "live");
export const SCORING_ROOM_INSTANT = buildPayload("scoring", "instant");
