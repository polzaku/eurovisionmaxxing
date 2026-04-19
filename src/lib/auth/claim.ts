import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import { DISPLAY_NAME_REGEX, normalizeDisplayName } from "@/lib/auth/onboard";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ClaimInput {
  userId: unknown;
  roomId: unknown;
  displayName: unknown;
}

export interface ClaimDeps {
  supabase: SupabaseClient<Database>;
  hashToken: (plaintext: string) => Promise<string>;
  generateRejoinToken: () => string;
  now: () => string;
}

export interface ClaimSuccess {
  ok: true;
  user: {
    userId: string;
    rejoinToken: string;
    displayName: string;
    avatarSeed: string;
  };
}

export interface ClaimFailure {
  ok: false;
  status: number;
  error: { code: ApiErrorCode; message: string; field?: string };
}

export type ClaimResult = ClaimSuccess | ClaimFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): ClaimFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

interface MembershipRow {
  users: { id: string; display_name: string; avatar_seed: string };
}

export async function claimIdentity(
  input: ClaimInput,
  deps: ClaimDeps,
): Promise<ClaimResult> {
  if (
    typeof input.userId !== "string" ||
    typeof input.roomId !== "string" ||
    typeof input.displayName !== "string"
  ) {
    return fail(
      "INVALID_BODY",
      "Request body must include userId, roomId, and displayName strings.",
      400,
    );
  }

  if (!UUID_V4_REGEX.test(input.userId)) {
    return fail("INVALID_USER_ID", "userId must be a UUID v4.", 400, "userId");
  }
  if (!UUID_V4_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID v4.", 400, "roomId");
  }

  const wantedName = normalizeDisplayName(input.displayName);
  if (!DISPLAY_NAME_REGEX.test(wantedName)) {
    return fail(
      "INVALID_DISPLAY_NAME",
      "displayName must be 2–24 characters and contain only letters, numbers, spaces, or hyphens.",
      400,
      "displayName",
    );
  }

  const { data: row, error: selectError } = await deps.supabase
    .from("room_memberships")
    .select("users!inner(id, display_name, avatar_seed)")
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (selectError) {
    return fail("INTERNAL_ERROR", "Could not verify candidate. Please try again.", 500);
  }
  if (!row) {
    return fail(
      "CANDIDATE_NOT_FOUND",
      "No candidate matches this id, room, and name.",
      404,
    );
  }

  const user = (row as unknown as MembershipRow).users;
  const storedNormalized = normalizeDisplayName(user.display_name).toLowerCase();
  if (storedNormalized !== wantedName.toLowerCase()) {
    return fail(
      "CANDIDATE_NOT_FOUND",
      "No candidate matches this id, room, and name.",
      404,
    );
  }

  const rejoinToken = deps.generateRejoinToken();
  const hash = await deps.hashToken(rejoinToken);
  const { error: updateError } = await deps.supabase
    .from("users")
    .update({ rejoin_token_hash: hash, last_seen_at: deps.now() })
    .eq("id", user.id);

  if (updateError) {
    return fail("INTERNAL_ERROR", "Could not merge identity. Please try again.", 500);
  }

  return {
    ok: true,
    user: {
      userId: user.id,
      rejoinToken,
      displayName: user.display_name,
      avatarSeed: user.avatar_seed,
    },
  };
}
