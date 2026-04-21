import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REJOIN_TOKEN_MAX_LEN = 512;

export interface RejoinInput {
  userId: unknown;
  rejoinToken: unknown;
  roomId?: unknown;
}

export interface RejoinDeps {
  supabase: SupabaseClient<Database>;
  compareToken: (plaintext: string, hash: string) => Promise<boolean>;
  now: () => string;
}

export interface RejoinSuccess {
  ok: true;
  user: { userId: string; displayName: string; avatarSeed: string };
}

export interface RejoinFailure {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    field?: string;
    params?: Record<string, unknown>;
  };
  status: number;
}

export type RejoinResult = RejoinSuccess | RejoinFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
  params?: Record<string, unknown>,
): RejoinFailure {
  const error: RejoinFailure["error"] = { code, message };
  if (field !== undefined) error.field = field;
  if (params !== undefined) error.params = params;
  return { ok: false, error, status };
}

export async function rejoinUser(
  input: RejoinInput,
  deps: RejoinDeps
): Promise<RejoinResult> {
  if (typeof input.userId !== "string" || typeof input.rejoinToken !== "string") {
    return fail(
      "INVALID_BODY",
      "Request body must include userId and rejoinToken strings.",
      400,
    );
  }

  const userId = input.userId;
  const rejoinToken = input.rejoinToken;

  if (rejoinToken.length > REJOIN_TOKEN_MAX_LEN) {
    return fail(
      "INVALID_BODY",
      `rejoinToken must be at most ${REJOIN_TOKEN_MAX_LEN} characters.`,
      400,
      "rejoinToken",
      { limit: REJOIN_TOKEN_MAX_LEN },
    );
  }

  if (input.roomId !== undefined && typeof input.roomId !== "string") {
    return fail("INVALID_BODY", "roomId must be a string when present.", 400, "roomId");
  }
  if (!UUID_V4_REGEX.test(userId)) {
    return fail("INVALID_BODY", "userId must be a UUID v4.", 400, "userId");
  }

  const { data, error: selectError } = await deps.supabase
    .from("users")
    .select("id, display_name, avatar_seed, rejoin_token_hash")
    .eq("id", userId)
    .maybeSingle();

  if (selectError) {
    return fail("INTERNAL_ERROR", "Could not verify session. Please try again.", 500);
  }
  if (!data) {
    return fail("USER_NOT_FOUND", "No user matches this session.", 404);
  }

  const tokenOk = await deps.compareToken(rejoinToken, data.rejoin_token_hash);
  if (!tokenOk) {
    return fail("INVALID_TOKEN", "Session token does not match.", 401);
  }

  const { error: updateError } = await deps.supabase
    .from("users")
    .update({ last_seen_at: deps.now() })
    .eq("id", userId);

  if (updateError) {
    return fail("INTERNAL_ERROR", "Could not refresh session. Please try again.", 500);
  }

  return {
    ok: true,
    user: {
      userId: data.id,
      displayName: data.display_name,
      avatarSeed: data.avatar_seed,
    },
  };
}
