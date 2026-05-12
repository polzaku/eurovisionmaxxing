/**
 * Fixtures for the L1 watcher-vs-driver surface differentiation Playwright spec.
 *
 * The key invariant: `queueLength: 10` so AnnouncingView mounts
 * `<StillToGiveLine>` (rendered only when isActiveDriver && announcementStyle
 * === 'full' && queueLength === 10). `currentAnnounceIdx: 3` splits the
 * canonical points sequence as:
 *   given    → [1, 2, 3]   (testids stg-given-1, stg-given-2, stg-given-3)
 *   remaining → [4, 5, 6, 7, 8, 10, 12]
 *
 * Shape mirrors the live `/api/rooms/{id}` and `/api/results/{id}` response
 * shapes — see `src/components/room/AnnouncingView.tsx` for the
 * `ResultsResponse` / `AnnouncementState` interfaces.
 */

export const ROOM_ID = "aaaaaaaa-0001-4000-8000-000000000001";
export const OWNER_ID = "bbbbbbbb-0002-4000-8000-000000000002";
export const GUEST_ID = "cccccccc-0003-4000-8000-000000000003";

export const CONTESTANTS = [
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
  {
    id: "2026-DE",
    year: 2026,
    event: "final",
    countryCode: "DE",
    country: "Germany",
    artist: "Test Artist DE",
    song: "Test Song DE",
    flagEmoji: "🇩🇪",
    runningOrder: 4,
  },
  {
    id: "2026-IT",
    year: 2026,
    event: "final",
    countryCode: "IT",
    country: "Italy",
    artist: "Test Artist IT",
    song: "Test Song IT",
    flagEmoji: "🇮🇹",
    runningOrder: 5,
  },
  {
    id: "2026-ES",
    year: 2026,
    event: "final",
    countryCode: "ES",
    country: "Spain",
    artist: "Test Artist ES",
    song: "Test Song ES",
    flagEmoji: "🇪🇸",
    runningOrder: 6,
  },
  {
    id: "2026-NO",
    year: 2026,
    event: "final",
    countryCode: "NO",
    country: "Norway",
    artist: "Test Artist NO",
    song: "Test Song NO",
    flagEmoji: "🇳🇴",
    runningOrder: 7,
  },
  {
    id: "2026-FI",
    year: 2026,
    event: "final",
    countryCode: "FI",
    country: "Finland",
    artist: "Test Artist FI",
    song: "Test Song FI",
    flagEmoji: "🇫🇮",
    runningOrder: 8,
  },
  {
    id: "2026-NL",
    year: 2026,
    event: "final",
    countryCode: "NL",
    country: "Netherlands",
    artist: "Test Artist NL",
    song: "Test Song NL",
    flagEmoji: "🇳🇱",
    runningOrder: 9,
  },
  {
    id: "2026-CH",
    year: 2026,
    event: "final",
    countryCode: "CH",
    country: "Switzerland",
    artist: "Test Artist CH",
    song: "Test Song CH",
    flagEmoji: "🇨🇭",
    runningOrder: 10,
  },
];

const MEMBERSHIPS = [
  { userId: OWNER_ID, displayName: "Alice", avatarSeed: "alice" },
  { userId: GUEST_ID, displayName: "Guest", avatarSeed: "guest" },
];

/**
 * `/api/rooms/{id}` response shape.
 *
 * `announcementMode: "live"` and `announcementStyle: "full"` — required for
 * AnnouncingView to mount StillToGiveLine (full-style active-driver path).
 * `announcingUserId: OWNER_ID` so the owner session is recognised as the
 * active announcer.
 */
export const ROOM_PAYLOAD = {
  room: {
    id: ROOM_ID,
    pin: "L1TEST",
    status: "announcing",
    ownerUserId: OWNER_ID,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "live",
    announcementStyle: "full" as const,
    announcementOrder: null,
    announcingUserId: OWNER_ID,
    currentAnnounceIdx: 3,
    votingEndsAt: null,
  },
  memberships: MEMBERSHIPS,
  contestants: CONTESTANTS,
  votes: [],
};

/**
 * `/api/results/{id}` shape when the owner (Alice) is the active announcer.
 *
 * `currentAnnounceIdx: 3` → given=[1,2,3], remaining=[4,5,6,7,8,10,12].
 * `queueLength: 10` → StillToGiveLine is mounted by AnnouncingView.
 * `pendingReveal.points: 4` → next reveal in the canonical sequence after idx 3.
 * `delegateUserId: null` → owner is the direct active driver (not a delegate).
 */
export const ANNOUNCING_RESULTS_DRIVER = {
  status: "announcing" as const,
  year: 2026,
  event: "final",
  pin: "L1TEST",
  contestants: CONTESTANTS,
  leaderboard: [
    { contestantId: "2026-SE", totalPoints: 28, rank: 1 },
    { contestantId: "2026-UA", totalPoints: 24, rank: 2 },
    { contestantId: "2026-FR", totalPoints: 20, rank: 3 },
    { contestantId: "2026-DE", totalPoints: 17, rank: 4 },
    { contestantId: "2026-IT", totalPoints: 14, rank: 5 },
    { contestantId: "2026-ES", totalPoints: 11, rank: 6 },
    { contestantId: "2026-NO", totalPoints: 9, rank: 7 },
    { contestantId: "2026-FI", totalPoints: 7, rank: 8 },
    { contestantId: "2026-NL", totalPoints: 5, rank: 9 },
    { contestantId: "2026-CH", totalPoints: 3, rank: 10 },
  ],
  announcement: {
    announcingUserId: OWNER_ID,
    announcingDisplayName: "Alice",
    announcingAvatarSeed: "alice",
    currentAnnounceIdx: 3,
    queueLength: 10,
    pendingReveal: { contestantId: "2026-DE", points: 4 },
    delegateUserId: null,
    announcerPosition: 1,
    announcerCount: 2,
    skippedUserIds: [],
  },
};
