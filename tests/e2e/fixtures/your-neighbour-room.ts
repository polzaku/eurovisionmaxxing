/**
 * Fixture for the `your_neighbour` personalized-award Playwright smoke. A
 * 3-voter `done` room where:
 *   - Alice (winning Best Vocals via the contestant award).
 *   - Bob and Carol are paired room-wide for `neighbourhood_voters`.
 *   - The viewer is `CAROL_ID`; their `personalNeighbours` entry points at
 *     Alice (so the cinematic slot lands between `neighbourhood_voters` and
 *     `the_dark_horse`, and the static `/results/[id]` card renders Alice).
 *
 * Shape mirrors the live `/api/results/{id}` `done` payload — see
 * `src/lib/results/loadResults.ts` and `src/lib/awards/buildPersonalNeighbours.ts`.
 */

export const ROOM_ID = "33333333-3333-3333-3333-333333333333";
export const ALICE_ID = "11111111-2222-4333-8444-000000000001";
export const BOB_ID = "22222222-3333-4444-8555-000000000002";
export const CAROL_ID = "33333333-4444-4555-8666-000000000003";

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

const MEMBERS = [
  { userId: ALICE_ID, displayName: "Alice", avatarSeed: "alice" },
  { userId: BOB_ID, displayName: "Bob", avatarSeed: "bob" },
  { userId: CAROL_ID, displayName: "Carol", avatarSeed: "carol" },
];

export const DONE_RESULTS_FIXTURE = {
  status: "done" as const,
  year: 2026,
  event: "final",
  pin: "YNCARD",
  ownerUserId: ALICE_ID,
  contestants: CONTESTANTS,
  leaderboard: [
    { contestantId: "2026-SE", totalPoints: 24, rank: 1 },
    { contestantId: "2026-UA", totalPoints: 18, rank: 2 },
  ],
  breakdowns: [],
  contestantBreakdowns: [],
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
      awardKey: "neighbourhood_voters",
      awardName: "Neighbourhood voters",
      winnerUserId: ALICE_ID,
      winnerUserIdB: BOB_ID,
      winnerContestantId: null,
      statValue: 0.91,
      statLabel: "Pearson 0.91",
    },
    {
      roomId: ROOM_ID,
      awardKey: "the_dark_horse",
      awardName: "The dark horse",
      winnerUserId: null,
      winnerUserIdB: null,
      winnerContestantId: "2026-UA",
      statValue: null,
      statLabel: "variance 4.2",
    },
    {
      roomId: ROOM_ID,
      awardKey: "the_enabler",
      awardName: "The enabler",
      winnerUserId: ALICE_ID,
      winnerUserIdB: null,
      winnerContestantId: null,
      statValue: null,
      statLabel: null,
    },
  ],
  members: MEMBERS,
  /**
   * Personal-neighbour entries — one per signal-bearing user. Carol's nearest
   * neighbour is Alice (non-reciprocal: Alice's nearest is Bob via the room-wide
   * award). Alice and Bob entries are present for payload realism but the
   * cinematic + static surfaces only ever render the viewer's row.
   */
  personalNeighbours: [
    {
      userId: ALICE_ID,
      neighbourUserId: BOB_ID,
      pearson: 0.91,
      isReciprocal: true,
    },
    {
      userId: BOB_ID,
      neighbourUserId: ALICE_ID,
      pearson: 0.91,
      isReciprocal: true,
    },
    {
      userId: CAROL_ID,
      neighbourUserId: ALICE_ID,
      pearson: 0.78,
      isReciprocal: false,
    },
  ],
};

export const ROOM_PAYLOAD = {
  room: {
    id: ROOM_ID,
    pin: "YNCARD",
    status: "done",
    ownerUserId: ALICE_ID,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "instant",
    announcementOrder: null,
    announcingUserId: null,
    currentAnnounceIdx: null,
    votingEndsAt: null,
  },
  memberships: MEMBERS,
  contestants: CONTESTANTS,
  votes: [],
};
