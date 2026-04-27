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
