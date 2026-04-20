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

export async function submitPinToApi(
  input: { pin: string; userId: string },
  deps: SubmitPinDeps
): Promise<SubmitPinResult> {
  const res = await deps.fetch("/api/rooms/join-by-pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: input.pin, userId: input.userId }),
  });

  const body = (await res.json()) as { roomId?: string };
  return { ok: true, roomId: body.roomId as string };
}
