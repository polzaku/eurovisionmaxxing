import type { VotingCategory } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";

const MAX_CATEGORIES = 8;
const CATEGORY_NAME_REGEX = /^[A-Za-z0-9 \-]{2,24}$/;
const HINT_MAX_LEN = 80;

export type ValidateCategoriesResult =
  | { ok: true; normalized: VotingCategory[] }
  | {
      ok: false;
      code: ApiErrorCode;
      message: string;
      field?: string;
      status: number;
    };

/**
 * SPEC §7.2 categories validation. Pulled from the inline block in
 * `createRoom.ts` so `updateRoomCategories` (TODO A2) can reuse the
 * exact same rules. Returns either the normalized `VotingCategory[]`
 * or a typed-error breakdown the caller can wrap in its own failure
 * shape.
 */
export function validateCategories(input: unknown): ValidateCategoriesResult {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      code: "INVALID_CATEGORIES",
      message: "categories must be an array.",
      field: "categories",
      status: 400,
    };
  }
  if (input.length < 1 || input.length > MAX_CATEGORIES) {
    return {
      ok: false,
      code: "INVALID_CATEGORIES",
      message: `categories must contain between 1 and ${MAX_CATEGORIES} items.`,
      field: "categories",
      status: 400,
    };
  }

  const normalized: VotingCategory[] = [];
  const seenNames = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) {
      return {
        ok: false,
        code: "INVALID_CATEGORY",
        message: "each category must be an object.",
        field: "categories",
        status: 400,
      };
    }
    const r = raw as { name?: unknown; weight?: unknown; hint?: unknown };
    if (typeof r.name !== "string" || !CATEGORY_NAME_REGEX.test(r.name.trim())) {
      return {
        ok: false,
        code: "INVALID_CATEGORY",
        message:
          "category name must be 2–24 characters (letters, numbers, spaces, hyphens).",
        field: "categories",
        status: 400,
      };
    }
    let weight = 1;
    if (r.weight !== undefined && r.weight !== null) {
      if (
        typeof r.weight !== "number" ||
        !Number.isInteger(r.weight) ||
        r.weight < 1 ||
        r.weight > 5
      ) {
        return {
          ok: false,
          code: "INVALID_CATEGORY",
          message: "category weight must be an integer between 1 and 5.",
          field: "categories",
          status: 400,
        };
      }
      weight = r.weight;
    }
    let hint: string | undefined;
    if (r.hint !== undefined && r.hint !== null) {
      if (typeof r.hint !== "string" || r.hint.length > HINT_MAX_LEN) {
        return {
          ok: false,
          code: "INVALID_CATEGORY",
          message: `category hint must be a string of at most ${HINT_MAX_LEN} characters.`,
          field: "categories",
          status: 400,
        };
      }
      hint = r.hint;
    }
    const nameTrimmed = r.name.trim();
    const nameKey = nameTrimmed.toLowerCase();
    if (seenNames.has(nameKey)) {
      return {
        ok: false,
        code: "INVALID_CATEGORIES",
        message: "category names must be unique (case-insensitive).",
        field: "categories",
        status: 400,
      };
    }
    seenNames.add(nameKey);
    const entry: VotingCategory = { name: nameTrimmed, weight };
    if (hint !== undefined) entry.hint = hint;
    normalized.push(entry);
  }

  return { ok: true, normalized };
}
