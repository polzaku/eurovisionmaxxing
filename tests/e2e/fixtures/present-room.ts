/**
 * Fixtures for the /present route Playwright specs. Mirrors the
 * live `/api/rooms/{id}` and `/api/results/{id}` response shapes for
 * three room states: lobby, announcing, done.
 */

export const PRESENT_ROOM_ID = "33333333-3333-3333-3333-333333333333";
export const PRESENT_OWNER_ID = "44444444-4444-4444-4444-444444444444";

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
  {
    id: "2026-FR",
    year: 2026,
    event: "final",
    countryCode: "FR",
    country: "France",
    artist: "Test Artist FR",
    song: "Test Song FR",
    flagEmoji: "🇫🇷",
    runningOrder: 3,
  },
];

const MEMBERSHIPS = [
  {
    userId: PRESENT_OWNER_ID,
    displayName: "Alice",
    avatarSeed: "alice",
  },
  {
    userId: "55555555-5555-5555-5555-555555555555",
    displayName: "Bob",
    avatarSeed: "bob",
  },
  {
    userId: "66666666-6666-6666-6666-666666666666",
    displayName: "Carol",
    avatarSeed: "carol",
  },
];

function roomPayload(status: string) {
  return {
    room: {
      id: PRESENT_ROOM_ID,
      pin: "PRSNT1",
      status,
      ownerUserId: PRESENT_OWNER_ID,
      categories: [{ name: "Vocals", weight: 1 }],
      announcementMode: "live",
      announcementOrder: null,
      announcingUserId: status === "announcing" ? PRESENT_OWNER_ID : null,
      currentAnnounceIdx: null,
      votingEndsAt: null,
    },
    memberships: MEMBERSHIPS,
    contestants: CONTESTANTS,
    votes: [],
  };
}

export const LOBBY_PAYLOAD = roomPayload("lobby");
export const ANNOUNCING_PAYLOAD = roomPayload("announcing");
export const DONE_PAYLOAD = roomPayload("done");

export const ANNOUNCING_RESULTS = {
  status: "announcing" as const,
  year: 2026,
  event: "final",
  pin: "PRSNT1",
  contestants: CONTESTANTS,
  leaderboard: [
    { contestantId: "2026-SE", totalPoints: 24, rank: 1 },
    { contestantId: "2026-UA", totalPoints: 18, rank: 2 },
    { contestantId: "2026-FR", totalPoints: 12, rank: 3 },
  ],
  announcement: null,
};

export const DONE_RESULTS = {
  status: "done" as const,
  year: 2026,
  event: "final",
  pin: "PRSNT1",
  contestants: CONTESTANTS,
  leaderboard: [
    { contestantId: "2026-SE", totalPoints: 32, rank: 1 },
    { contestantId: "2026-UA", totalPoints: 28, rank: 2 },
    { contestantId: "2026-FR", totalPoints: 19, rank: 3 },
  ],
  breakdowns: [],
  hotTakes: [],
  awards: [],
  members: MEMBERSHIPS,
};
