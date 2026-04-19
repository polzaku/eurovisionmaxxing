import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "INVALID_ROOM_ID"
  | "INVALID_USER_ID"
  | "USER_NOT_FOUND"
  | "ROOM_NOT_FOUND"
  | "CANDIDATE_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; field?: string };
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = field
    ? { error: { code, message, field } }
    : { error: { code, message } };
  return NextResponse.json(body, { status });
}