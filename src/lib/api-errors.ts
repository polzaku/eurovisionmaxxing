import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "INVALID_ROOM_ID"
  | "INVALID_USER_ID"
  | "INVALID_PIN"
  | "INVALID_YEAR"
  | "INVALID_EVENT"
  | "INVALID_CATEGORIES"
  | "INVALID_CATEGORY"
  | "INVALID_ANNOUNCEMENT_MODE"
  | "INVALID_STATUS"
  | "INVALID_TRANSITION"
  | "VOTING_ENDING_NOT_ELAPSED"
  | "INVALID_CONTESTANT_ID"
  | "FORBIDDEN"
  | "USER_NOT_FOUND"
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_JOINABLE"
  | "ROOM_NOT_VOTING"
  | "ROOM_NOT_ANNOUNCING"
  | "ROOM_NOT_INSTANT"
  | "ANNOUNCE_RACED"
  | "NOW_PERFORMING_DISABLED"
  | "CANDIDATE_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";

// TODO(i18n-phase-b): extract this `error` shape into a shared `ApiErrorPayload` type
// and reuse it in OnboardFailure.error and RejoinFailure.error to eliminate the
// three-site structural duplication.
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    field?: string;
    /**
     * ICU MessageFormat substitution values forwarded to the client for
     * translation. Keys should match the placeholders in the corresponding
     * `errors.<code>` message in each locale file.
     */
    params?: Record<string, unknown>;
  };
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
  /**
   * ICU MessageFormat substitution values forwarded to the client for
   * translation. Keys should match the placeholders in the corresponding
   * `errors.<code>` message in each locale file.
   */
  params?: Record<string, unknown>,
): NextResponse<ApiErrorBody> {
  const error: ApiErrorBody["error"] = { code, message };
  if (field !== undefined) error.field = field;
  if (params !== undefined) error.params = params;
  return NextResponse.json({ error }, { status });
}
