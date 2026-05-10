import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface ApplySingleSkipInput {
  roomId: string;
  skippedUserId: string;
}

export interface ApplySingleSkipDeps {
  supabase: SupabaseClient<Database>;
}

export interface ApplySingleSkipSuccess {
  ok: true;
  skippedUserId: string;
}

export interface ApplySingleSkipFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string };
}

export type ApplySingleSkipResult =
  | ApplySingleSkipSuccess
  | ApplySingleSkipFailure;

/**
 * The inner DB-mutation step of skipping a single user (SPEC §10.2.1).
 * Marks every results row owned by `skippedUserId` in `roomId` as
 * `announced = true` so the live leaderboard reflects their points,
 * but the dramatic per-point reveal is suppressed.
 *
 * Does NOT mutate `rooms.announce_skipped_user_ids` — that's the
 * caller's responsibility, since the caller may be batching multiple
 * skips into a single room UPDATE (cascade case).
 *
 * Does NOT broadcast — the caller broadcasts in cascade order so the
 * client-side banner queue receives them in sequence.
 */
export async function applySingleSkip(
  input: ApplySingleSkipInput,
  deps: ApplySingleSkipDeps,
): Promise<ApplySingleSkipResult> {
  const markAnnounced = await deps.supabase
    .from("results")
    .update({ announced: true })
    .eq("room_id", input.roomId)
    .eq("user_id", input.skippedUserId);

  if (markAnnounced.error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not mark skipped user's points as announced.",
      },
    };
  }

  return { ok: true, skippedUserId: input.skippedUserId };
}
