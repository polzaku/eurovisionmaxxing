import type { Room, VotingCategory } from "@/types";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

interface Deps {
  fetch: typeof globalThis.fetch;
}

export interface ContestantsPreview {
  count: number;
  preview: Array<{ flag: string; country: string }>;
}

interface ApiContestantsResponse {
  contestants?: Array<{ country?: string; flagEmoji?: string }>;
  error?: string;
}

export async function fetchContestantsPreview(
  year: number,
  event: "semi1" | "semi2" | "final",
  deps: Deps,
  options?: { signal?: AbortSignal },
): Promise<
  | { ok: true; data: ContestantsPreview }
  | { ok: false; code: string; message: string }
> {
  let res: Response;
  try {
    res = await deps.fetch(
      `/api/contestants?year=${year}&event=${event}`,
      options?.signal ? { signal: options.signal } : undefined,
    );
  } catch (err) {
    // Distinguish caller-driven aborts (year/event change mid-flight)
    // from real network failures so the UI doesn't render an error
    // when it should just discard the stale response.
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, code: "ABORTED", message: "" };
    }
    return { ok: false, code: "NETWORK", message: GENERIC_MESSAGE };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as ApiContestantsResponse;
      const contestants = body.contestants ?? [];
      const preview = contestants.slice(0, 3).map((c) => ({
        flag: c.flagEmoji ?? "",
        country: c.country ?? "",
      }));
      return { ok: true, data: { count: contestants.length, preview } };
    } catch {
      return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
    }
  }

  // The /api/contestants route returns `{ error: <string> }` on failure
  // (not the structured { error: {code, message} } shape of other routes).
  // Map a 404 to a stable code so the wizard can display a helpful message.
  if (res.status === 404) {
    return {
      ok: false,
      code: "CONTEST_DATA_NOT_FOUND",
      message:
        "We couldn't load contestant data for this event. Try a different year or event.",
    };
  }
  return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
}

export interface CreateRoomApiInput {
  year: number;
  event: "semi1" | "semi2" | "final";
  categories: VotingCategory[];
  announcementMode: "live" | "instant";
  allowNowPerforming: boolean;
  userId: string;
}

export async function createRoomApi(
  input: CreateRoomApiInput,
  deps: Deps
): Promise<
  | { ok: true; room: Room }
  | { ok: false; code: string; field?: string; message: string }
> {
  let res: Response;
  try {
    res = await deps.fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, code: "NETWORK", message: GENERIC_MESSAGE };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as { room?: Room };
      if (body.room) return { ok: true, room: body.room };
    } catch {
      // fall through
    }
    return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
  }

  try {
    const body = (await res.json()) as {
      error?: { code?: string; field?: string; message?: string };
    };
    const err = body.error ?? {};
    return {
      ok: false,
      code: err.code ?? "INTERNAL_ERROR",
      message: err.message ?? GENERIC_MESSAGE,
      ...(err.field ? { field: err.field } : {}),
    };
  } catch {
    return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
  }
}
