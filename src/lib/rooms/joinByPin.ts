import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

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
  const pin = input.pin as string;
  const userId = input.userId as string;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status")
    .eq("pin", pin)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "No room matches that PIN.", 404);
  }
  const row = roomQuery.data as { id: string; status: string };

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
