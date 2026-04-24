import { runRequest, type ApiOk, type ApiFail, type Deps } from "@/lib/room/api";

export interface PostVoteInput {
  roomId: string;
  userId: string;
  contestantId: string;
  scores?: Record<string, number | null>;
  missed?: boolean;
  hotTake?: string | null;
}

export interface PostVoteResponseData {
  vote: unknown;
  scoredCount: number;
}

export type PostVoteResult = ApiOk<PostVoteResponseData> | ApiFail;

/**
 * POST /api/rooms/{roomId}/votes — upsert the caller's vote for one
 * contestant. Accepts partial `scores`, `missed`, `hotTake`. Server merges
 * with the existing row. See SPEC §8 + PR #15.
 */
export async function postVote(
  input: PostVoteInput,
  deps: Deps
): Promise<PostVoteResult> {
  const body: Record<string, unknown> = {
    userId: input.userId,
    contestantId: input.contestantId,
  };
  if (input.scores !== undefined) body.scores = input.scores;
  if (input.missed !== undefined) body.missed = input.missed;
  if (input.hotTake !== undefined) body.hotTake = input.hotTake;

  return runRequest<PostVoteResponseData>(
    () =>
      deps.fetch(`/api/rooms/${input.roomId}/votes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    (raw) => raw as PostVoteResponseData
  );
}
