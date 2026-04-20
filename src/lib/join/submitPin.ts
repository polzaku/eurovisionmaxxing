export interface SubmitPinSuccess {
  ok: true;
  roomId: string;
}

export interface SubmitPinFailure {
  ok: false;
  code: string;
  field?: string;
  message: string;
}

export type SubmitPinResult = SubmitPinSuccess | SubmitPinFailure;

export interface SubmitPinDeps {
  fetch: typeof globalThis.fetch;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export async function submitPinToApi(
  input: { pin: string; userId: string },
  deps: SubmitPinDeps
): Promise<SubmitPinResult> {
  let res: Response;
  try {
    res = await deps.fetch("/api/rooms/join-by-pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: input.pin, userId: input.userId }),
    });
  } catch {
    return { ok: false, code: "NETWORK", message: GENERIC_MESSAGE };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as { roomId?: string };
      if (typeof body.roomId === "string") {
        return { ok: true, roomId: body.roomId };
      }
    } catch {
      // fall through to generic failure
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
