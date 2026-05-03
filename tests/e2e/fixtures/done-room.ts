/**
 * Fixture for the Phase 6.2 awards-ceremony Playwright smoke. Shape mirrors
 * the live `/api/results/{id}` `done` payload (see `src/lib/results/loadResults.ts`)
 * and the `/api/rooms/{id}` payload (see `src/lib/rooms/get.ts`). UUIDs are
 * deterministic so the spec can reference them.
 */

export const ROOM_ID = "11111111-1111-1111-1111-111111111111";
export const USER_ID = "22222222-2222-2222-2222-222222222222";

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

export const DONE_RESULTS_FIXTURE = {
  status: "done" as const,
  year: 2026,
  event: "final",
  pin: "ABCDEF",
  contestants: CONTESTANTS,
  leaderboard: [
    { contestantId: "2026-SE", totalPoints: 24, rank: 1 },
    { contestantId: "2026-UA", totalPoints: 18, rank: 2 },
  ],
  breakdowns: [],
  hotTakes: [],
  awards: [
    {
      roomId: ROOM_ID,
      awardKey: "best_vocals",
      awardName: "Best Vocals",
      winnerUserId: null,
      winnerUserIdB: null,
      winnerContestantId: "2026-SE",
      statValue: null,
      statLabel: "9.4 avg",
    },
    {
      roomId: ROOM_ID,
      awardKey: "the_enabler",
      awardName: "The enabler",
      winnerUserId: USER_ID,
      winnerUserIdB: null,
      winnerContestantId: null,
      statValue: null,
      statLabel: null,
    },
  ],
  members: [
    {
      userId: USER_ID,
      displayName: "Alice",
      avatarSeed: "alice",
    },
  ],
};

export const ROOM_PAYLOAD = {
  room: {
    id: ROOM_ID,
    pin: "ABCDEF",
    status: "done",
    ownerUserId: USER_ID,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "instant",
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
};
