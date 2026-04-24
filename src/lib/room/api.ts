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
};

export async function fetchRoomData(
  roomId: string,
  deps: Deps
): Promise<ApiOk<FetchRoomData> | ApiFail> {
  return runRequest<FetchRoomData>(
    () => deps.fetch(`/api/rooms/${roomId}`),
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
