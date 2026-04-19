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

export async function joinByPin(
  _input: JoinByPinInput,
  _deps: JoinByPinDeps
): Promise<JoinByPinResult> {
  throw new Error("not implemented");
}
