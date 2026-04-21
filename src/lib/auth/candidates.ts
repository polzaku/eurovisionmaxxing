import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import { DISPLAY_NAME_REGEX, normalizeDisplayName } from "@/lib/auth/onboard";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface CandidatesInput {
  displayName: unknown;
  roomId: unknown;
}

export interface CandidatesDeps {
  supabase: SupabaseClient<Database>;
}

export interface CandidatesSuccess {
  ok: true;
  candidates: Array<{ userId: string; avatarSeed: string }>;
}

export interface CandidatesFailure {
  ok: false;
  status: number;
  error: { code: ApiErrorCode; message: string; field?: string };
}

export type CandidatesResult = CandidatesSuccess | CandidatesFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): CandidatesFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

export async function listCandidates(
  input: CandidatesInput,
  deps: CandidatesDeps,
): Promise<CandidatesResult> {
  if (typeof input.displayName !== "string" || typeof input.roomId !== "string") {
    return fail(
      "INVALID_BODY",
      "Request body must include displayName and roomId strings.",
      400,
    );
  }

  const displayName = normalizeDisplayName(input.displayName);
  if (!DISPLAY_NAME_REGEX.test(displayName)) {
    return fail(
      "INVALID_DISPLAY_NAME",
      "displayName must be 2–24 characters and contain only letters, numbers, spaces, or hyphens.",
      400,
      "displayName",
    );
  }

  const roomId = input.roomId;
  if (!UUID_V4_REGEX.test(roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID v4.", 400, "roomId");
  }

  const { data: roomRow, error: roomError } = await deps.supabase
    .from("rooms")
    .select("id")
    .eq("id", roomId)
    .maybeSingle();

  if (roomError) {
    return fail("INTERNAL_ERROR", "Could not verify room. Please try again.", 500);
  }
  if (!roomRow) {
    return fail("ROOM_NOT_FOUND", "No room matches this id.", 404);
  }

  const { data: rows, error: membershipsError } = await deps.supabase
    .from("room_memberships")
    .select("users!inner(id, display_name, avatar_seed)")
    .eq("room_id", roomId);

  if (membershipsError) {
    return fail(
      "INTERNAL_ERROR",
      "Could not list candidates. Please try again.",
      500,
    );
  }

  interface MembershipRow {
    users: { id: string; display_name: string; avatar_seed: string };
  }

  const wanted = displayName.toLowerCase();
  const candidates = (rows as unknown as MembershipRow[])
    .map((r) => r.users)
    .filter((u) => normalizeDisplayName(u.display_name).toLowerCase() === wanted)
    .map((u) => ({ userId: u.id, avatarSeed: u.avatar_seed }));

  return { ok: true, candidates };
}
