import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

export const DISPLAY_NAME_REGEX = /^[A-Za-z0-9 \-]{2,24}$/;
const AVATAR_SEED_MAX_LEN = 64;

export interface OnboardInput {
  displayName: unknown;
  avatarSeed: unknown;
}

export interface OnboardDeps {
  supabase: SupabaseClient<Database>;
  hashToken: (plaintext: string) => Promise<string>;
  generateUserId: () => string;
  generateRejoinToken: () => string;
}

export interface OnboardSuccess {
  ok: true;
  user: {
    userId: string;
    rejoinToken: string;
    displayName: string;
    avatarSeed: string;
  };
}

export interface OnboardFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type OnboardResult = OnboardSuccess | OnboardFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): OnboardFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function onboardUser(
  input: OnboardInput,
  deps: OnboardDeps
): Promise<OnboardResult> {
  if (typeof input.displayName !== "string" || typeof input.avatarSeed !== "string") {
    return fail(
      "INVALID_BODY",
      "Request body must include displayName and avatarSeed strings.",
      400
    );
  }

  const displayName = normalizeDisplayName(input.displayName);
  if (!DISPLAY_NAME_REGEX.test(displayName)) {
    return fail(
      "INVALID_DISPLAY_NAME",
      "displayName must be 2–24 characters and contain only letters, numbers, spaces, or hyphens.",
      400,
      "displayName"
    );
  }

  const avatarSeed = input.avatarSeed;
  if (avatarSeed.length < 1 || avatarSeed.length > AVATAR_SEED_MAX_LEN) {
    return fail(
      "INVALID_AVATAR_SEED",
      `avatarSeed must be 1–${AVATAR_SEED_MAX_LEN} characters.`,
      400,
      "avatarSeed"
    );
  }

  const userId = deps.generateUserId();
  const rejoinToken = deps.generateRejoinToken();
  const rejoinTokenHash = await deps.hashToken(rejoinToken);

  const { error } = await deps.supabase.from("users").insert({
    id: userId,
    display_name: displayName,
    avatar_seed: avatarSeed,
    rejoin_token_hash: rejoinTokenHash,
  });

  if (error) {
    return fail("INTERNAL_ERROR", "Could not create user. Please try again.", 500);
  }

  return {
    ok: true,
    user: { userId, rejoinToken, displayName, avatarSeed },
  };
}
