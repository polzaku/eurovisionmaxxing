import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "USER_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    field?: string;
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
