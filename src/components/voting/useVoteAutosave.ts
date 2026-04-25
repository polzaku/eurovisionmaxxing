"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveStatus } from "@/lib/voting/Autosaver";
import {
  OfflineAdapter,
  type OfflineAdapterState,
} from "@/lib/voting/OfflineAdapter";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import type { DisplaySaveStatus } from "@/components/voting/SaveChip";

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
  status: DisplaySaveStatus;
  offlineBannerVisible: boolean;
}

/**
 * Hook composes Autosaver (debounced, per-contestant coalesce; unchanged
 * from PR #22) with OfflineAdapter (wraps post with localStorage queue +
 * online detection).
 *
 * DisplaySaveStatus is "offline" when the queue is non-empty OR the browser
 * is offline; otherwise it's the Autosaver's status. offlineBannerVisible
 * is strictly `!online` so mid-drain UX shows only the chip.
 *
 * See docs/superpowers/specs/2026-04-24-voting-offline-queue-design.md §6.
 */
export function useVoteAutosave(
  params: UseVoteAutosaveParams
): UseVoteAutosaveResult {
  const [autosaverStatus, setAutosaverStatus] = useState<SaveStatus>("idle");
  const [adapterState, setAdapterState] = useState<OfflineAdapterState>({
    online: true,
    queueSize: 0,
  });
  const saverRef = useRef<Autosaver | null>(null);

  useEffect(() => {
    if (!params.userId) {
      saverRef.current = null;
      setAutosaverStatus("idle");
      setAdapterState({ online: true, queueSize: 0 });
      return;
    }

    const storage =
      typeof window !== "undefined" ? window.localStorage : null;

    const adapter = new OfflineAdapter({
      realPost: params.post,
      storage,
      onStateChange: setAdapterState,
    });

    const saver = new Autosaver(params.roomId, params.userId, {
      post: (payload) => adapter.post(payload),
      onStatusChange: setAutosaverStatus,
    });
    saverRef.current = saver;

    return () => {
      saver.dispose();
      adapter.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [params.roomId, params.userId, params.post]);

  const onScoreChange = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      saverRef.current?.schedule(contestantId, categoryName, next);
    },
    []
  );

  const status: DisplaySaveStatus =
    adapterState.queueSize > 0 || !adapterState.online
      ? "offline"
      : autosaverStatus;

  return {
    onScoreChange,
    status,
    offlineBannerVisible: !adapterState.online,
  };
}
