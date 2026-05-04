import { runRequest, type ApiOk, type ApiFail, type Deps } from "@/lib/room/api";

export interface DeleteHotTakeApiInput {
  roomId: string;
  /** Caller's user id (must be the room owner per §6.7 in MVP). */
  userId: string;
  /** The contestant whose hot-take is being deleted. */
  contestantId: string;
  /** The author of the hot-take being deleted. */
  targetUserId: string;
}

export interface DeleteHotTakeApiData {
  /** True iff a row was actually modified. */
  deleted: boolean;
}

export type DeleteHotTakeApiResult =
  | ApiOk<DeleteHotTakeApiData>
  | ApiFail;

/**
 * DELETE /api/rooms/{roomId}/votes/{contestantId}/hot-take — admin-only
 * removal of another user's hot-take. SPEC §8.7.2.
 */
export async function deleteHotTakeApi(
  input: DeleteHotTakeApiInput,
  deps: Deps,
): Promise<DeleteHotTakeApiResult> {
  return runRequest<DeleteHotTakeApiData>(
    () =>
      deps.fetch(
        `/api/rooms/${encodeURIComponent(input.roomId)}/votes/${encodeURIComponent(input.contestantId)}/hot-take`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: input.userId,
            targetUserId: input.targetUserId,
          }),
        },
      ),
    (raw) => raw as DeleteHotTakeApiData,
  );
}
