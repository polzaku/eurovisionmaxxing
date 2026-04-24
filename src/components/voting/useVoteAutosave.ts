"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveStatus } from "@/lib/voting/Autosaver";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";

export interface UseVoteAutosaveParams {
  roomId: string;
  userId: string | null;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
}

export interface UseVoteAutosaveResult {
  onScoreChange: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  status: SaveStatus;
}

/**
 * Hook that owns an Autosaver instance keyed by (roomId, userId).
 * See docs/superpowers/specs/2026-04-24-voting-autosave-design.md §5.
 */
export function useVoteAutosave(
  params: UseVoteAutosaveParams
): UseVoteAutosaveResult {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saverRef = useRef<Autosaver | null>(null);

  useEffect(() => {
    if (!params.userId) {
      saverRef.current = null;
      setStatus("idle");
      return;
    }
    const saver = new Autosaver(params.roomId, params.userId, {
      post: params.post,
      onStatusChange: setStatus,
    });
    saverRef.current = saver;
    return () => {
      saver.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [params.roomId, params.userId, params.post]);

  const onScoreChange = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      saverRef.current?.schedule(contestantId, categoryName, next);
    },
    []
  );

  return { onScoreChange, status };
}
