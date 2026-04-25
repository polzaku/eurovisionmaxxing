"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveStatus } from "@/lib/voting/Autosaver";
import {
  OfflineAdapter,
  type OfflineAdapterState,
  type DrainNotice,
} from "@/lib/voting/OfflineAdapter";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import type { DisplaySaveStatus } from "@/components/voting/SaveChip";

export interface UseVoteAutosaveParams {
  roomId: string;
  userId: string | null;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
  /** Optional — when provided, drain runs a server-state pre-fetch to detect conflicts. */
  fetchServerVotes?: (
    roomId: string,
    userId: string
  ) => Promise<{ contestantId: string; updatedAt: string }[]>;
}

export interface UseVoteAutosaveResult {
  onScoreChange: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  onMissedChange: (contestantId: string, missed: boolean) => void;
  status: DisplaySaveStatus;
  offlineBannerVisible: boolean;
  drainNotice: DrainNotice | null;
  dismissDrainNotice: () => void;
  queueOverflow: boolean;
}

/**
 * Hook composes:
 *  - Autosaver (PR #22) — debounced per-contestant coalesce
 *  - OfflineAdapter (PR #25 + #26) — localStorage queue, online detection,
 *    conflict reconciliation, 200-cap, voting-ended abort
 *
 * DisplaySaveStatus is "offline" when queue non-empty OR browser offline.
 * offlineBannerVisible is strictly !online (mid-drain UX shows only the chip).
 * drainNotice surfaces server-newer conflicts and voting-ended events from
 * the most recent drain; null when none.
 * queueOverflow is true while the queue is at its 200-entry cap.
 */
export function useVoteAutosave(
  params: UseVoteAutosaveParams
): UseVoteAutosaveResult {
  const [autosaverStatus, setAutosaverStatus] = useState<SaveStatus>("idle");
  const [adapterState, setAdapterState] = useState<OfflineAdapterState>({
    online: true,
    queueSize: 0,
    overflowed: false,
  });
  const [drainNotice, setDrainNotice] = useState<DrainNotice | null>(null);
  const saverRef = useRef<Autosaver | null>(null);

  useEffect(() => {
    if (!params.userId) {
      saverRef.current = null;
      setAutosaverStatus("idle");
      setAdapterState({ online: true, queueSize: 0, overflowed: false });
      setDrainNotice(null);
      return;
    }

    const storage =
      typeof window !== "undefined" ? window.localStorage : null;

    const adapter = new OfflineAdapter({
      realPost: params.post,
      storage,
      onStateChange: setAdapterState,
      fetchServerVotes: params.fetchServerVotes,
      onDrainComplete: setDrainNotice,
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
  }, [params.roomId, params.userId, params.post, params.fetchServerVotes]);

  const onScoreChange = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      saverRef.current?.schedule(contestantId, categoryName, next);
    },
    []
  );

  const onMissedChange = useCallback(
    (contestantId: string, missed: boolean) => {
      saverRef.current?.scheduleMissed(contestantId, missed);
    },
    []
  );

  const dismissDrainNotice = useCallback(() => setDrainNotice(null), []);

  const status: DisplaySaveStatus =
    adapterState.queueSize > 0 || !adapterState.online
      ? "offline"
      : autosaverStatus;

  return {
    onScoreChange,
    onMissedChange,
    status,
    offlineBannerVisible: !adapterState.online,
    drainNotice,
    dismissDrainNotice,
    queueOverflow: adapterState.overflowed,
  };
}
