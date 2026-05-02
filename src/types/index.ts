// ─── Session (localStorage) ──────────────────────────────────────────────────

export interface LocalSession {
  userId: string; // UUID v4
  rejoinToken: string; // UUID v4, server-generated
  displayName: string;
  avatarSeed: string; // seed string used for DiceBear
  expiresAt: string; // ISO 8601, 90 days from creation
}

// ─── Contestant ──────────────────────────────────────────────────────────────

export type EventType = "semi1" | "semi2" | "final";

export interface Contestant {
  id: string; // "{year}-{countryCode}" e.g. "2026-gb"
  country: string; // "United Kingdom"
  countryCode: string; // ISO 3166-1 alpha-2, lowercase: "gb"
  flagEmoji: string; // "🇬🇧"
  artist: string;
  song: string;
  runningOrder: number; // 1-indexed
  event: EventType;
  year: number;
}

// ─── Room ────────────────────────────────────────────────────────────────────

export type RoomStatus =
  | "lobby"
  | "voting"
  | "voting_ending"
  | "scoring"
  | "announcing"
  | "done";
export type AnnouncementMode = "live" | "instant";

export interface VotingCategory {
  name: string; // 2–24 chars
  weight: number; // 0.5–5, step 0.5, default 1
  hint?: string; // max 80 chars, tooltip text
  // SPEC §21.6 — i18n keys
  key?: string;
  nameKey?: string;
  hintKey?: string;
}

export interface Room {
  id: string;
  pin: string;
  year: number;
  event: EventType;
  categories: VotingCategory[];
  ownerUserId: string;
  status: RoomStatus;
  announcementMode: AnnouncementMode;
  announcementOrder: string[] | null; // ordered userIds for live mode
  announcingUserId: string | null;
  currentAnnounceIdx: number;
  nowPerformingId: string | null; // contestant id currently performing
  allowNowPerforming: boolean;
  votingEndsAt: string | null;
  votingEndedAt: string | null;
  createdAt: string;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  displayName: string;
  avatarSeed: string;
  createdAt: string;
  lastSeenAt: string;
}

// ─── Room Membership ─────────────────────────────────────────────────────────

export interface RoomMembership {
  roomId: string;
  userId: string;
  joinedAt: string;
  isReady: boolean;
  readyAt: string | null;  // ISO timestamp; null when not yet ready
}

// ─── Votes ───────────────────────────────────────────────────────────────────

export interface Vote {
  id: string;
  roomId: string;
  userId: string;
  contestantId: string;
  scores: Record<string, number> | null; // {categoryName: score 1-10}
  missed: boolean;
  hotTake: string | null;
  updatedAt: string;
}

// ─── Results ─────────────────────────────────────────────────────────────────

export interface Result {
  roomId: string;
  userId: string;
  contestantId: string;
  weightedScore: number;
  rank: number;
  pointsAwarded: number; // 0,1,2,3,4,5,6,7,8,10,12
  announced: boolean;
}

// ─── Awards ──────────────────────────────────────────────────────────────────

export type AwardKey =
  | "harshest_critic"
  | "biggest_stan"
  | "hive_mind_master"
  | "most_contrarian"
  | "neighbourhood_voters"
  | "the_dark_horse"
  | "fashion_stan"
  | "the_enabler"
  | `best_${string}`; // category awards: "best_vocals", etc.

export interface RoomAward {
  roomId: string;
  awardKey: string;
  awardName: string;
  winnerUserId: string | null; // null for contestant awards
  winnerUserIdB: string | null; // SPEC §11.2: paired-winner slot for Neighbourhood voters and 2-way personality ties
  winnerContestantId: string | null; // null for user awards
  statValue: number | null;
  statLabel: string | null;
}

// ─── Realtime Events ─────────────────────────────────────────────────────────

export type RoomEvent =
  | { type: "status_changed"; status: RoomStatus }
  | { type: "voting_ending"; votingEndsAt: string }
  | { type: "user_joined"; user: { id: string; displayName: string; avatarSeed: string } }
  | { type: "user_left"; userId: string }
  | { type: "now_performing"; contestantId: string }
  | { type: "voting_progress"; userId: string; contestantId: string; scoredCount: number }
  | { type: "announce_next"; contestantId: string; points: number; announcingUserId: string }
  | { type: "announce_skip"; userId: string; displayName: string }
  | { type: "announce_turn"; userId: string }
  | { type: "score_update"; contestantId: string; newTotal: number; newRank: number }
  | {
      type: "member_ready";
      userId: string;
      readyAt: string;
      readyCount: number;
      totalCount: number;
    };

// ─── Voting Templates ────────────────────────────────────────────────────────

export interface VotingTemplate {
  id: string;
  name: string;
  description: string;
  categories: VotingCategory[];
  // SPEC §21.6 — i18n keys
  key?: string;
  nameKey?: string;
  descriptionKey?: string;
}

// ─── Eurovision points mapping ───────────────────────────────────────────────

export const EUROVISION_POINTS: Record<number, number> = {
  1: 12,
  2: 10,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
};

// ─── Score anchors ───────────────────────────────────────────────────────────

export const SCORE_ANCHORS = {
  1: "Devastating. A moment I will try to forget.",
  5: "Fine. Watched it. Won't remember it.",
  10: "Absolute masterpiece. My 12 points. Iconic.",
} as const;

// ─── PIN charset ─────────────────────────────────────────────────────────────

export const PIN_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
