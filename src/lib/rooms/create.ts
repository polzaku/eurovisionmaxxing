import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room, VotingCategory } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { mapRoom } from "@/lib/rooms/shared";

export interface CreateRoomInput {
  year: unknown;
  event: unknown;
  categories: unknown;
  announcementMode: unknown;
  allowNowPerforming: unknown;
  userId: unknown;
}

export interface CreateRoomDeps {
  supabase: SupabaseClient<Database>;
  generateRoomId: () => string;
  generatePin: (length: number) => string;
  currentYear?: () => number;
  maxShortPinRetries?: number;
  maxLongPinRetries?: number;
}

export interface CreateRoomSuccess {
  ok: true;
  room: Room;
}

export interface CreateRoomFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type CreateRoomResult = CreateRoomSuccess | CreateRoomFailure;

const EVENT_VALUES = ["semi1", "semi2", "final"] as const;
const MODE_VALUES = ["live", "instant"] as const;
const MIN_YEAR = 2000;
const MAX_CATEGORIES = 8;
const CATEGORY_NAME_REGEX = /^[A-Za-z0-9 \-]{2,24}$/;
const HINT_MAX_LEN = 80;

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): CreateRoomFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

interface ValidInput {
  year: number;
  event: (typeof EVENT_VALUES)[number];
  announcementMode: (typeof MODE_VALUES)[number];
  allowNowPerforming: boolean;
  userId: string;
  categories: VotingCategory[];
}

function validateInput(
  input: CreateRoomInput,
  currentYear: number
): { ok: true; input: ValidInput } | { ok: false; failure: CreateRoomFailure } {
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return {
      ok: false,
      failure: fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId"),
    };
  }

  if (typeof input.allowNowPerforming !== "boolean") {
    return {
      ok: false,
      failure: fail(
        "INVALID_BODY",
        "allowNowPerforming must be a boolean.",
        400,
        "allowNowPerforming"
      ),
    };
  }

  if (
    typeof input.year !== "number" ||
    !Number.isInteger(input.year) ||
    input.year < MIN_YEAR ||
    input.year > currentYear
  ) {
    return {
      ok: false,
      failure: fail(
        "INVALID_YEAR",
        `year must be an integer between ${MIN_YEAR} and ${currentYear}.`,
        400,
        "year"
      ),
    };
  }

  if (
    typeof input.event !== "string" ||
    !(EVENT_VALUES as readonly string[]).includes(input.event)
  ) {
    return {
      ok: false,
      failure: fail(
        "INVALID_EVENT",
        `event must be one of ${EVENT_VALUES.join(", ")}.`,
        400,
        "event"
      ),
    };
  }

  if (
    typeof input.announcementMode !== "string" ||
    !(MODE_VALUES as readonly string[]).includes(input.announcementMode)
  ) {
    return {
      ok: false,
      failure: fail(
        "INVALID_ANNOUNCEMENT_MODE",
        `announcementMode must be one of ${MODE_VALUES.join(", ")}.`,
        400,
        "announcementMode"
      ),
    };
  }

  if (!Array.isArray(input.categories)) {
    return {
      ok: false,
      failure: fail(
        "INVALID_CATEGORIES",
        "categories must be an array.",
        400,
        "categories"
      ),
    };
  }
  if (input.categories.length < 1 || input.categories.length > MAX_CATEGORIES) {
    return {
      ok: false,
      failure: fail(
        "INVALID_CATEGORIES",
        `categories must contain between 1 and ${MAX_CATEGORIES} items.`,
        400,
        "categories"
      ),
    };
  }

  const normalized: VotingCategory[] = [];
  const seenNames = new Set<string>();
  for (const raw of input.categories) {
    if (typeof raw !== "object" || raw === null) {
      return {
        ok: false,
        failure: fail(
          "INVALID_CATEGORY",
          "each category must be an object.",
          400,
          "categories"
        ),
      };
    }
    const r = raw as { name?: unknown; weight?: unknown; hint?: unknown };
    if (typeof r.name !== "string" || !CATEGORY_NAME_REGEX.test(r.name.trim())) {
      return {
        ok: false,
        failure: fail(
          "INVALID_CATEGORY",
          "category name must be 2–24 characters (letters, numbers, spaces, hyphens).",
          400,
          "categories"
        ),
      };
    }
    let weight: number = 1;
    if (r.weight !== undefined && r.weight !== null) {
      if (
        typeof r.weight !== "number" ||
        !Number.isInteger(r.weight) ||
        r.weight < 1 ||
        r.weight > 5
      ) {
        return {
          ok: false,
          failure: fail(
            "INVALID_CATEGORY",
            "category weight must be an integer between 1 and 5.",
            400,
            "categories"
          ),
        };
      }
      weight = r.weight;
    }
    let hint: string | undefined;
    if (r.hint !== undefined && r.hint !== null) {
      if (typeof r.hint !== "string" || r.hint.length > HINT_MAX_LEN) {
        return {
          ok: false,
          failure: fail(
            "INVALID_CATEGORY",
            `category hint must be a string of at most ${HINT_MAX_LEN} characters.`,
            400,
            "categories"
          ),
        };
      }
      hint = r.hint;
    }
    const nameTrimmed = r.name.trim();
    const nameKey = nameTrimmed.toLowerCase();
    if (seenNames.has(nameKey)) {
      return {
        ok: false,
        failure: fail(
          "INVALID_CATEGORIES",
          "category names must be unique (case-insensitive).",
          400,
          "categories"
        ),
      };
    }
    seenNames.add(nameKey);
    const entry: VotingCategory = { name: nameTrimmed, weight };
    if (hint !== undefined) entry.hint = hint;
    normalized.push(entry);
  }

  return {
    ok: true,
    input: {
      year: input.year,
      event: input.event as (typeof EVENT_VALUES)[number],
      announcementMode: input.announcementMode as (typeof MODE_VALUES)[number],
      allowNowPerforming: input.allowNowPerforming,
      userId: input.userId,
      categories: normalized,
    },
  };
}

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: { code?: string } | null): boolean {
  return !!err && err.code === PG_UNIQUE_VIOLATION;
}

async function insertRoomWithPin(
  deps: CreateRoomDeps,
  valid: ValidInput,
  roomId: string
): Promise<{ ok: true; row: RoomRow } | { ok: false; collided: boolean }> {
  const shortRetries = deps.maxShortPinRetries ?? 5;
  const longRetries = deps.maxLongPinRetries ?? 5;
  const attempts: Array<{ length: number }> = [
    ...Array.from({ length: shortRetries }, () => ({ length: 6 })),
    ...Array.from({ length: longRetries }, () => ({ length: 7 })),
  ];

  for (const { length } of attempts) {
    const pin = deps.generatePin(length);
    const { data, error } = await deps.supabase
      .from("rooms")
      .insert({
        id: roomId,
        pin,
        year: valid.year,
        event: valid.event,
        categories: valid.categories,
        owner_user_id: valid.userId,
        announcement_mode: valid.announcementMode,
        allow_now_performing: valid.allowNowPerforming,
      })
      .select()
      .single();

    if (!error && data) return { ok: true, row: data as RoomRow };
    if (isUniqueViolation(error as { code?: string } | null)) continue;
    return { ok: false, collided: false };
  }
  return { ok: false, collided: true };
}

export async function createRoom(
  input: CreateRoomInput,
  deps: CreateRoomDeps
): Promise<CreateRoomResult> {
  const currentYear = (deps.currentYear ?? (() => new Date().getUTCFullYear()))();
  const validated = validateInput(input, currentYear);
  if (!validated.ok) return validated.failure;
  const valid = validated.input;

  const roomId = deps.generateRoomId();
  const inserted = await insertRoomWithPin(deps, valid, roomId);
  if (!inserted.ok) {
    return fail("INTERNAL_ERROR", "Could not create room. Please try again.", 500);
  }

  const { error: membershipError } = await deps.supabase
    .from("room_memberships")
    .insert({
      room_id: roomId,
      user_id: valid.userId,
    });

  if (membershipError) {
    await deps.supabase.from("rooms").delete().eq("id", roomId);
    return fail("INTERNAL_ERROR", "Could not create room. Please try again.", 500);
  }

  return { ok: true, room: mapRoom(inserted.row) };
}
