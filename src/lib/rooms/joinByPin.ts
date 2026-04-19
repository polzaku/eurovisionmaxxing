import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import { PIN_CHARSET } from "@/types";

const PIN_REGEX = new RegExp(`^[${PIN_CHARSET}]{6,7}$`);

const UNJOINABLE_STATUSES: ReadonlySet<string> = new Set([
  "scoring",
  "announcing",
  "done",
]);

function normalizePin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toUpperCase();
  if (!PIN_REGEX.test(normalized)) return null;
  return normalized;
}

export interface JoinByPinInput {
  pin: unknown;
  userId: unknown;
}

export interface JoinByPinDeps {
  supabase: SupabaseClient<Database>;
}

export interface JoinByPinSuccess {
  ok: true;
  roomId: string;
}

export interface JoinByPinFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type JoinByPinResult = JoinByPinSuccess | JoinByPinFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): JoinByPinFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

export async function joinByPin(
  input: JoinByPinInput,
  deps: JoinByPinDeps
): Promise<JoinByPinResult> {
  const pin = normalizePin(input.pin);
  if (pin === null) {
    return fail(
      "INVALID_PIN",
      "pin must be 6-7 characters from the Eurovision PIN charset.",
      400,
      "pin"
    );
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId"
    );
  }
  const userId = input.userId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status")
    .eq("pin", pin)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "No room matches that PIN.", 404);
  }
  const row = roomQuery.data as { id: string; status: string };

  if (UNJOINABLE_STATUSES.has(row.status)) {
    return fail(
      "ROOM_NOT_JOINABLE",
      "This room is no longer accepting new members.",
      409
    );
  }

  const { error: upsertError } = await deps.supabase
    .from("room_memberships")
    .upsert(
      { room_id: row.id, user_id: userId },
      { onConflict: "room_id,user_id", ignoreDuplicates: true }
    );

  if (upsertError) {
    return fail("INTERNAL_ERROR", "Could not join room. Please try again.", 500);
  }
  return { ok: true, roomId: row.id };
}
