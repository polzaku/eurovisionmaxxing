const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export interface ApiOk<T> {
  ok: true;
  data?: T;
}

export interface ApiFail {
  ok: false;
  code: string;
  field?: string;
  message: string;
}

export interface Deps {
  fetch: typeof globalThis.fetch;
}

async function unwrap<T>(
  res: Response,
  extract?: (body: unknown) => T
): Promise<ApiOk<T> | ApiFail> {
  if (res.ok) {
    try {
      const body = await res.json();
      return extract ? { ok: true, data: extract(body) } : { ok: true };
    } catch {
      return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
    }
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

export async function runRequest<T>(
  req: () => Promise<Response>,
  extract?: (body: unknown) => T
): Promise<ApiOk<T> | ApiFail> {
  let res: Response;
  try {
    res = await req();
  } catch {
    return { ok: false, code: "NETWORK", message: GENERIC_MESSAGE };
  }
  return unwrap(res, extract);
}

export type FetchRoomData = {
  room: unknown;
  memberships: unknown[];
  contestants: unknown[];
  votes: unknown[];
};

export async function fetchRoomData(
  roomId: string,
  userId: string | null,
  deps: Deps
): Promise<ApiOk<FetchRoomData> | ApiFail> {
  const url = userId
    ? `/api/rooms/${roomId}?userId=${encodeURIComponent(userId)}`
    : `/api/rooms/${roomId}`;
  return runRequest<FetchRoomData>(
    () => deps.fetch(url),
    (body) => body as FetchRoomData
  );
}

export async function joinRoomApi(
  roomId: string,
  userId: string,
  deps: Deps
): Promise<ApiOk<never> | ApiFail> {
  return runRequest(() =>
    deps.fetch(`/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    })
  );
}

export async function patchRoomStatus(
  roomId: string,
  status: string,
  userId: string,
  deps: Deps
): Promise<ApiOk<never> | ApiFail> {
  return runRequest(() =>
    deps.fetch(`/api/rooms/${roomId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, userId }),
    })
  );
}

/**
 * Trigger the SPEC §9 scoring pipeline. Admin-only on the server side
 * (`runScoring` enforces ownership); the client surface should still gate
 * the affordance to admins for UX.
 */
export async function postRoomScore(
  roomId: string,
  userId: string,
  deps: Deps
): Promise<ApiOk<{ leaderboard: unknown[] }> | ApiFail> {
  return runRequest(() =>
    deps.fetch(`/api/rooms/${roomId}/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    })
  );
}

/**
 * Advance the live-mode announcement by one reveal. Server enforces that
 * the caller is the current announcer or the room owner.
 */
export interface AnnounceNextSuccess {
  contestantId: string;
  points: number;
  announcingUserId: string;
  newTotal: number;
  newRank: number;
  nextAnnouncingUserId: string | null;
  finished: boolean;
}

export async function postAnnounceNext(
  roomId: string,
  userId: string,
  deps: Deps
): Promise<ApiOk<AnnounceNextSuccess> | ApiFail> {
  return runRequest<AnnounceNextSuccess>(
    () =>
      deps.fetch(`/api/rooms/${roomId}/announce/next`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    (body) => body as AnnounceNextSuccess,
  );
}

/**
 * Owner-only skip of the current announcer (SPEC §10.2.1). Used when the
 * announcer is absent at their turn — admin keeps the show moving by
 * skipping past them. Their points are silently marked as announced so
 * the live leaderboard reflects them.
 */
export interface AnnounceSkipSuccess {
  skippedUserId: string;
  skippedDisplayName: string;
  nextAnnouncingUserId: string | null;
  finished: boolean;
}

export async function postAnnounceSkip(
  roomId: string,
  userId: string,
  deps: Deps,
): Promise<ApiOk<AnnounceSkipSuccess> | ApiFail> {
  return runRequest<AnnounceSkipSuccess>(
    () =>
      deps.fetch(`/api/rooms/${roomId}/announce/skip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    (body) => body as AnnounceSkipSuccess,
  );
}

/**
 * SPEC §10.2.1 — admin reverses a manual skip. Companion to postAnnounceSkip.
 * Re-inserts `restoreUserId` after the current announcer; the user's
 * `announced=true` results flip back so reveals replay dramatically.
 */
export interface AnnounceRestoreSuccess {
  restoredUserId: string;
  restoredDisplayName: string;
  announcementOrder: string[];
  announceSkippedUserIds: string[];
}

export async function postAnnounceRestore(
  roomId: string,
  userId: string,
  restoreUserId: string,
  deps: Deps,
): Promise<ApiOk<AnnounceRestoreSuccess> | ApiFail> {
  return runRequest<AnnounceRestoreSuccess>(
    () =>
      deps.fetch(`/api/rooms/${roomId}/announce/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, restoreUserId }),
      }),
    (body) => body as AnnounceRestoreSuccess,
  );
}

/**
 * SPEC §10.2.1 — owner reshuffles the announcement order before any
 * point has been revealed. Server hard-gates on no
 * `results.announced=true` rows; the UI should mirror that gate.
 */
export interface AnnouncementOrderReshuffleSuccess {
  announcementOrder: string[];
  announcingUserId: string;
}

export async function patchAnnouncementOrder(
  roomId: string,
  userId: string,
  deps: Deps,
): Promise<ApiOk<AnnouncementOrderReshuffleSuccess> | ApiFail> {
  return runRequest<AnnouncementOrderReshuffleSuccess>(
    () =>
      deps.fetch(`/api/rooms/${roomId}/announcement-order`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    (body) => body as AnnouncementOrderReshuffleSuccess,
  );
}

/**
 * Owner-only handoff: take over (`takeControl: true`) or release back to
 * the original announcer (`takeControl: false`). SPEC §10.2 step 7.
 */
export async function postAnnounceHandoff(
  roomId: string,
  userId: string,
  takeControl: boolean,
  deps: Deps
): Promise<ApiOk<{ delegateUserId: string | null }> | ApiFail> {
  return runRequest<{ delegateUserId: string | null }>(
    () =>
      deps.fetch(`/api/rooms/${roomId}/announce/handoff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, takeControl }),
      }),
    (body) => body as { delegateUserId: string | null },
  );
}

export interface PostRoomReadySuccess {
  readyAt: string;
  readyCount: number;
  totalCount: number;
}

/**
 * Mark the current user as ready in instant mode. Broadcasts a member_ready
 * event to all room subscribers.
 */
export async function postRoomReady(
  roomId: string,
  userId: string,
  deps: Deps
): Promise<ApiOk<PostRoomReadySuccess> | ApiFail> {
  return runRequest<PostRoomReadySuccess>(
    () =>
      deps.fetch(`/api/rooms/${roomId}/ready`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    (body) => body as PostRoomReadySuccess,
  );
}

export interface PostRoomOwnPointsSuccess {
  entries: Array<{
    contestantId: string;
    pointsAwarded: number;
    hotTake: string | null;
  }>;
}

export async function postRoomOwnPoints(
  roomId: string,
  userId: string,
  deps: Deps,
): Promise<ApiOk<PostRoomOwnPointsSuccess> | ApiFail> {
  return runRequest<PostRoomOwnPointsSuccess>(
    () =>
      deps.fetch(`/api/rooms/${roomId}/own-points`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    (body) => body as PostRoomOwnPointsSuccess,
  );
}

/**
 * SPEC §5.1d — admin-only contestant refresh from the lobby. Re-fetches
 * the §5.1 cascade with cache bypass server-side, broadcasts
 * `contestants_refreshed`, and returns the fresh list so the caller can
 * update local state immediately.
 */
export interface RefreshContestantsSuccess {
  contestants: Array<{
    id: string;
    year: number;
    event: string;
    countryCode: string;
    country: string;
    artist: string;
    song: string;
    flagEmoji: string;
    runningOrder: number;
  }>;
}

export async function refreshContestantsApi(
  roomId: string,
  userId: string,
  deps: Deps,
): Promise<ApiOk<RefreshContestantsSuccess> | ApiFail> {
  return runRequest<RefreshContestantsSuccess>(
    () =>
      deps.fetch(`/api/rooms/${roomId}/refresh-contestants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    (body) => body as RefreshContestantsSuccess,
  );
}

/**
 * SPEC §6.1 / TODO A2 — owner-only switch of `announcement_mode` between
 * 'live' and 'instant' while the room is still in the lobby.
 */
export async function patchAnnouncementMode(
  roomId: string,
  mode: "live" | "instant",
  userId: string,
  deps: Deps,
): Promise<ApiOk<never> | ApiFail> {
  return runRequest(() =>
    deps.fetch(`/api/rooms/${roomId}/announcement-mode`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, userId }),
    }),
  );
}

/**
 * SPEC §6.1 / TODO A2 — owner-only swap of the room's categories array
 * (template change or custom) while still in the lobby.
 */
export interface VotingCategoryShape {
  name: string;
  weight?: number;
  hint?: string;
}

export async function patchRoomCategories(
  roomId: string,
  categories: VotingCategoryShape[],
  userId: string,
  deps: Deps,
): Promise<ApiOk<never> | ApiFail> {
  return runRequest(() =>
    deps.fetch(`/api/rooms/${roomId}/categories`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categories, userId }),
    }),
  );
}
