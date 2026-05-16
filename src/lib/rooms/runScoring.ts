import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Contestant, EventType, Vote, VotingCategory } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { scoreRoom, type LeaderboardEntry } from "@/lib/scoring";
import { computeAwards } from "@/lib/awards/computeAwards";
import { ContestDataError } from "@/lib/contestants";
import type { RoomEventPayload } from "@/lib/rooms/shared";
import { isAbsent } from "@/lib/rooms/isAbsent";
import { applySingleSkip } from "@/lib/rooms/applySingleSkip";
import {
  selectShortBatchRows,
  twelvePointIdx,
} from "./autoBatchShortStyle";
import type { AnnouncerResultRow } from "./advanceAnnouncement";
import { buildBatchBroadcastPayload } from "./buildBatchBroadcastPayload";

export interface RunScoringInput {
  roomId: unknown;
  userId: unknown;
}

export interface RunScoringDeps {
  supabase: SupabaseClient<Database>;
  fetchContestants: (year: number, event: EventType) => Promise<Contestant[]>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
  /**
   * Optional shuffle hook for live-mode `announcement_order` initialisation.
   * Defaults to Fisher-Yates with `Math.random`. Tests inject a deterministic
   * permutation. Pure: receives a fresh array, returns a new one (or mutates
   * in place — caller doesn't care).
   */
  shuffle?: <T>(arr: T[]) => T[];
  /** Injected for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface RunScoringSuccess {
  ok: true;
  leaderboard: LeaderboardEntry[];
}

export interface RunScoringFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type RunScoringResult = RunScoringSuccess | RunScoringFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): RunScoringFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

type RoomSelectRow = {
  id: string;
  status: string;
  owner_user_id: string;
  year: number;
  event: string;
  categories: VotingCategory[];
  announcement_mode: string;
  announcement_style: string;
  voting_ends_at: string | null;
};

function defaultShuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type VoteRow = Database["public"]["Tables"]["votes"]["Row"];

function mapVote(row: VoteRow): Vote {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    contestantId: row.contestant_id,
    scores: row.scores,
    missed: row.missed,
    hotTake: row.hot_take,
    hotTakeEditedAt: row.hot_take_edited_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Orchestrate the SPEC §9 scoring pipeline against Supabase.
 *
 * Transitions room `voting → scoring → announcing` (SPEC §9), fills missed
 * votes per SPEC §9.1, writes the `results` table per SPEC §9.5.
 *
 * Idempotent under retry: if a prior attempt reached `scoring` but crashed
 * before `announcing`, calling again reruns the work cleanly (votes UPDATEs
 * are no-ops when the filled values are already in place; results UPSERTs on
 * composite PK; the second status transition is conditional).
 */
export async function runScoring(
  input: RunScoringInput,
  deps: RunScoringDeps,
): Promise<RunScoringResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId",
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;

  const now = deps.now ? deps.now() : new Date();

  // 1. Load the room.
  const roomQuery = await deps.supabase
    .from("rooms")
    .select(
      "id, status, owner_user_id, year, event, categories, announcement_mode, announcement_style, voting_ends_at",
    )
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as RoomSelectRow;

  // 2. Owner check.
  if (room.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can trigger scoring.",
      403,
    );
  }

  // 3. Status guard. Accepts voting (legacy direct path), voting_ending (after
  //    the §6.3.1 5-s undo window has elapsed), or scoring (idempotent retry).
  if (
    room.status !== "voting" &&
    room.status !== "voting_ending" &&
    room.status !== "scoring"
  ) {
    return fail(
      "ROOM_NOT_VOTING",
      "Scoring can only be triggered while the room is voting.",
      409,
    );
  }

  // 3a. For voting_ending, the deadline must have elapsed (server-authoritative).
  if (room.status === "voting_ending") {
    if (
      !room.voting_ends_at ||
      Date.parse(room.voting_ends_at) > now.getTime()
    ) {
      return fail(
        "VOTING_ENDING_NOT_ELAPSED",
        "Cannot finalize before the countdown completes.",
        409,
      );
    }
  }

  // 4. Transition (voting | voting_ending) → scoring (conditional, idempotent under retry).
  const toScoring = await deps.supabase
    .from("rooms")
    .update({ status: "scoring", voting_ended_at: now.toISOString() })
    .eq("id", roomId)
    .in("status", ["voting", "voting_ending", "scoring"])
    .select("id")
    .maybeSingle();

  if (toScoring.error || !toScoring.data) {
    return fail(
      "INTERNAL_ERROR",
      "Could not start scoring. Please try again.",
      500,
    );
  }

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "status_changed",
      status: "scoring",
    });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed:scoring' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }

  // 5. Load pipeline inputs.
  let contestants: Contestant[];
  try {
    contestants = await deps.fetchContestants(
      room.year,
      room.event as EventType,
    );
  } catch (err) {
    if (err instanceof ContestDataError) {
      return fail(
        "INTERNAL_ERROR",
        "Could not load contestant data for scoring.",
        500,
      );
    }
    throw err;
  }

  const membershipQuery = await deps.supabase
    .from("room_memberships")
    .select("user_id, joined_at, users(display_name)")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });

  if (membershipQuery.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not load room memberships for scoring.",
      500,
    );
  }
  type MembershipWithUser = {
    user_id: string;
    users: { display_name: string } | null;
  };
  const memberRows = (membershipQuery.data ?? []) as MembershipWithUser[];
  const userIds = memberRows.map((m) => m.user_id);
  const usersForAwards = memberRows.map((m) => ({
    userId: m.user_id,
    displayName: m.users?.display_name ?? "",
  }));

  const votesQuery = await deps.supabase
    .from("votes")
    .select("*")
    .eq("room_id", roomId);

  if (votesQuery.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not load votes for scoring.",
      500,
    );
  }
  const rawVotes = ((votesQuery.data ?? []) as VoteRow[]).map(mapVote);

  // 6. Run the pure pipeline.
  const out = scoreRoom({
    categories: room.categories,
    contestants: contestants.map((c) => ({ id: c.id, country: c.country })),
    userIds,
    votes: rawVotes,
  });

  // 7. Write filled scores back for missed votes (preserve missed=true).
  for (const v of out.filledVotes) {
    if (!v.missed) continue;
    const upd = await deps.supabase
      .from("votes")
      .update({ scores: v.scores })
      .eq("id", v.id);
    if (upd.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not write filled vote scores.",
        500,
      );
    }
  }

  // 8. UPSERT results (SPEC §9.5).
  if (out.results.length > 0) {
    const rows = out.results.map((r) => ({
      room_id: roomId,
      user_id: r.userId,
      contestant_id: r.contestantId,
      weighted_score: r.weightedScore,
      rank: r.rank,
      points_awarded: r.pointsAwarded,
    }));
    const resultsUpsert = await deps.supabase
      .from("results")
      .upsert(rows, { onConflict: "room_id,user_id,contestant_id" });
    if (resultsUpsert.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not write scoring results.",
        500,
      );
    }
  }

  // 8a. Compute + UPSERT awards (SPEC §11). Pure function over the data we
  // already have; no extra IO for compute. Idempotent under retry via
  // `(room_id, award_key)` composite PK.
  const awards = computeAwards({
    categories: room.categories,
    contestants: contestants.map((c) => ({ id: c.id, country: c.country })),
    users: usersForAwards,
    votes: out.filledVotes,
    results: out.results,
  });
  if (awards.length > 0) {
    const awardRows = awards.map((a) => ({
      room_id: roomId,
      award_key: a.awardKey,
      award_name: a.awardName,
      winner_user_id: a.winnerUserId,
      winner_user_id_b: a.winnerUserIdB,
      winner_contestant_id: a.winnerContestantId,
      stat_value: a.statValue,
      stat_label: a.statLabel,
    }));
    const awardsUpsert = await deps.supabase
      .from("room_awards")
      .upsert(awardRows, { onConflict: "room_id,award_key" });
    if (awardsUpsert.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not write awards.",
        500,
      );
    }
  }

  // 9. Transition scoring → calibration (live) or scoring → announcing
  // (instant). Calibration is a pre-announce review phase where every
  // member can peek at their own 1→12 picks before the owner triggers
  // the live reveals (TODO #10 slice B). Instant mode has no per-user
  // reveal to prep for, so it skips calibration. The announcement_order
  // (live only) is initialised here either way — it's persisted with
  // the calibration status and read by the calibration UI to show
  // "Bob will announce first".
  const nextStatus: "calibration" | "announcing" =
    room.announcement_mode === "live" ? "calibration" : "announcing";
  const announcingPatch: {
    status: "calibration" | "announcing";
    announcement_order?: string[];
    announcing_user_id?: string | null;
    current_announce_idx?: number;
    announce_skipped_user_ids?: string[];
  } = { status: nextStatus };

  // Pre-cascade skipped list — populated below in live mode only.
  const preSkipped: string[] = [];
  // True only when pre-cascade found a present user (i.e. firstPresentIdx < order.length).
  // Broadcasts and applySingleSkip calls are guarded by this flag.
  let preSkipFoundPresent = false;

  if (room.announcement_mode === "live") {
    // Eligible announcers: users with at least one points_awarded > 0 row.
    // Users who only landed on rank-11+ contestants have nothing to reveal.
    const eligible = new Set<string>();
    for (const r of out.results) {
      if (r.pointsAwarded > 0) eligible.add(r.userId);
    }
    const eligibleOrdered = userIds.filter((u) => eligible.has(u));
    const shuffle = deps.shuffle ?? defaultShuffle;
    const order = shuffle(eligibleOrdered);

    // Pre-cascade: skip absent users from the front of the order so the
    // room never enters 'announcing' with an absent first announcer (SPEC §10.2.1).
    // Snapshot 'now' once — same instant used for all probes in this call.
    const cascadeNow = (deps.now ?? (() => new Date()))();
    let firstPresentIdx = order.length; // sentinel: all absent

    for (let i = 0; i < order.length; i++) {
      const candidateId = order[i];

      const membershipQuery = await deps.supabase
        .from("room_memberships")
        .select("last_seen_at")
        .eq("room_id", roomId)
        .eq("user_id", candidateId)
        .maybeSingle();

      if (membershipQuery.error) {
        return fail(
          "INTERNAL_ERROR",
          "Could not read membership for pre-cascade presence check.",
          500,
        );
      }

      const lastSeenAt = membershipQuery.data?.last_seen_at ?? null;

      if (!isAbsent(lastSeenAt as string | null, cascadeNow)) {
        // Present — stop here.
        firstPresentIdx = i;
        break;
      }

      preSkipped.push(candidateId);
    }

    // SPEC §10.2.1 line 967 — silent-mark only when a present user was found.
    // Pre-cascade exhaust (firstPresentIdx === order.length) leaves results
    // announced=false for the upcoming 'Finish the show' batch reveal
    // (SPEC §10.2.1 line 981).
    if (firstPresentIdx < order.length) {
      preSkipFoundPresent = true;
      for (const skippedUserId of preSkipped) {
        const skipResult = await applySingleSkip(
          { roomId, skippedUserId },
          { supabase: deps.supabase },
        );
        if (!skipResult.ok) {
          return fail(skipResult.error.code, skipResult.error.message, 500);
        }
      }
    }

    announcingPatch.announcement_order = order;
    announcingPatch.announcing_user_id =
      firstPresentIdx < order.length ? order[firstPresentIdx] : null;
    announcingPatch.current_announce_idx = 0;
    if (preSkipped.length > 0) {
      announcingPatch.announce_skipped_user_ids = preSkipped;
    }
  }

  const toAnnouncing = await deps.supabase
    .from("rooms")
    .update(announcingPatch)
    .eq("id", roomId)
    .eq("status", "scoring")
    .select("id")
    .maybeSingle();

  if (toAnnouncing.error || !toAnnouncing.data) {
    return fail(
      "INTERNAL_ERROR",
      "Could not finalise scoring. Please try again.",
      500,
    );
  }

  // Emit announce_skip broadcasts for each pre-cascade skipped user, AFTER
  // the room UPDATE commits. Non-fatal — state is already written.
  // Unconditional: banners fire even on cascade-exhaust (all-absent) path.
  // applySingleSkip is still gated on preSkipFoundPresent (spec §10.2.1 line 981).
  if (preSkipped.length > 0) {
    const usersQuery = await deps.supabase
      .from("users")
      .select("id, display_name")
      .in("id", preSkipped);

    const usersData = (usersQuery.data ?? []) as Array<{
      id: string;
      display_name: string;
    }>;
    const nameById = new Map(usersData.map((u) => [u.id, u.display_name]));

    for (const skippedId of preSkipped) {
      const displayName = nameById.get(skippedId) ?? skippedId;
      try {
        await deps.broadcastRoomEvent(roomId, {
          type: "announce_skip",
          userId: skippedId,
          displayName,
        });
      } catch (err) {
        console.warn(
          `broadcast 'announce_skip' failed for room ${roomId} user ${skippedId}; state committed regardless:`,
          err,
        );
      }
    }
  }

  // SPEC §10.2.2 — under live + short, the first present announcer's
  // rank-2-through-10 rows auto-reveal at turn start, leaving only the
  // rank-1 (12-point) row pending. Skipped when no announcer was chosen
  // (cascade-exhausted) or style is 'full' (default).
  if (
    room.announcement_mode === "live" &&
    room.announcement_style === "short" &&
    announcingPatch.announcing_user_id
  ) {
    const firstAnnouncerId = announcingPatch.announcing_user_id;

    // Load the announcer's reveal queue, sorted rank DESC (idx 0 = 1pt, idx 9 = 12pt).
    const queueQuery = await deps.supabase
      .from("results")
      .select("contestant_id, points_awarded, rank, announced")
      .eq("room_id", roomId)
      .eq("user_id", firstAnnouncerId)
      .gt("points_awarded", 0)
      .order("rank", { ascending: false });

    if (queueQuery.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not load reveal queue for short-style auto-batch.",
        500,
      );
    }
    const queueRows = (queueQuery.data ?? []) as AnnouncerResultRow[];
    const batchRows = selectShortBatchRows(queueRows);
    const twelveIdx = twelvePointIdx(queueRows);

    if (batchRows.length > 0 && twelveIdx !== null) {
      const batchIds = batchRows.map((r) => r.contestant_id);
      // Mark all 9 rows as announced in a single UPDATE.
      const markBatch = await deps.supabase
        .from("results")
        .update({ announced: true })
        .eq("room_id", roomId)
        .eq("user_id", firstAnnouncerId)
        .in("contestant_id", batchIds);

      if (markBatch.error) {
        return fail(
          "INTERNAL_ERROR",
          "Could not mark short-style auto-batch rows.",
          500,
        );
      }

      // Move current_announce_idx to the 12-point row's position.
      const updateIdx = await deps.supabase
        .from("rooms")
        .update({ current_announce_idx: twelveIdx })
        .eq("id", roomId)
        .eq("status", "announcing")
        .eq("announcing_user_id", firstAnnouncerId)
        .eq("current_announce_idx", 0);

      if (updateIdx.error) {
        return fail(
          "INTERNAL_ERROR",
          "Could not advance index past auto-batch.",
          500,
        );
      }

      // Build the broadcast payload from the post-batch leaderboard.
      const leaderboardQuery = await deps.supabase
        .from("results")
        .select("contestant_id, points_awarded, announced")
        .eq("room_id", roomId);

      if (leaderboardQuery.error) {
        // Non-fatal — broadcast a payload using the batch rows' awarded
        // points as fallback totals (degraded but consistent).
        const fallbackPayload = batchRows.map((r) => ({
          contestantId: r.contestant_id,
          points: r.points_awarded,
          newTotal: r.points_awarded,
          newRank: 1,
        }));
        try {
          await deps.broadcastRoomEvent(roomId, {
            type: "score_batch_revealed",
            announcingUserId: firstAnnouncerId,
            contestants: fallbackPayload,
          });
        } catch (err) {
          console.warn(
            `broadcast 'score_batch_revealed' (fallback payload) failed for room ${roomId}; state committed regardless:`,
            err,
          );
        }
      } else {
        const broadcastContestants = buildBatchBroadcastPayload(
          batchRows,
          leaderboardQuery.data ?? [],
        );
        try {
          await deps.broadcastRoomEvent(roomId, {
            type: "score_batch_revealed",
            announcingUserId: firstAnnouncerId,
            contestants: broadcastContestants,
          });
        } catch (err) {
          console.warn(
            `broadcast 'score_batch_revealed' failed for room ${roomId}; state committed regardless:`,
            err,
          );
        }
      }
    }
  }

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "status_changed",
      status: nextStatus,
    });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed:${nextStatus}' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }

  return { ok: true, leaderboard: out.leaderboard };
}
