"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import UserPicksList from "@/components/voting/UserPicksList";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import type { Contestant } from "@/types";

interface OwnBreakdown {
  userId: string;
  displayName: string;
  avatarSeed: string;
  picks: Array<{ contestantId: string; pointsAwarded: number }>;
}

interface CalibrationResultsResponse {
  status?: string;
  contestants?: Contestant[];
  ownBreakdown?: OwnBreakdown | null;
  firstAnnouncerName?: string | null;
}

export interface CalibrationViewProps {
  roomId: string;
  currentUserId: string;
  isOwner: boolean;
  /** Called when the realtime hook sees a status change away from calibration. */
  onCalibrationEnded?: () => void;
}

/**
 * TODO #10 slice B — pre-announce review surface. Every member sees
 * their own 1→12 ranking. The owner sees a "Start announcing" CTA
 * that POSTs `/api/rooms/[id]/start-announcing` and broadcasts the
 * status_changed event so every client transitions out at the same
 * moment. Non-owners see a "Waiting for the host…" line.
 */
export default function CalibrationView({
  roomId,
  currentUserId,
  isOwner,
  onCalibrationEnded,
}: CalibrationViewProps) {
  const t = useTranslations("calibration");
  const [contestants, setContestants] = useState<Contestant[]>([]);
  const [ownBreakdown, setOwnBreakdown] = useState<OwnBreakdown | null>(null);
  const [firstAnnouncerName, setFirstAnnouncerName] = useState<string | null>(
    null,
  );
  const [startState, setStartState] = useState<{
    kind: "idle" | "submitting";
    error?: string;
  }>({ kind: "idle" });

  const refetch = useCallback(async () => {
    try {
      const url = `/api/results/${encodeURIComponent(roomId)}?asUser=${encodeURIComponent(currentUserId)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as CalibrationResultsResponse;
      if (body.status && body.status !== "calibration") {
        onCalibrationEnded?.();
        return;
      }
      if (body.contestants) setContestants(body.contestants);
      if (body.ownBreakdown !== undefined) setOwnBreakdown(body.ownBreakdown);
      if (body.firstAnnouncerName !== undefined) {
        setFirstAnnouncerName(body.firstAnnouncerName);
      }
    } catch {
      // swallow — next event will retry
    }
  }, [roomId, currentUserId, onCalibrationEnded]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRoomRealtime(roomId, (event) => {
    if (event.type === "status_changed" && event.status !== "calibration") {
      onCalibrationEnded?.();
    }
  });

  const handleStart = useCallback(async () => {
    setStartState({ kind: "submitting" });
    try {
      const res = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/start-announcing`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStartState({
          kind: "idle",
          error: text || t("startError"),
        });
        return;
      }
      // The status_changed broadcast will fire onCalibrationEnded on
      // every client (including this one) — no manual transition needed.
    } catch {
      setStartState({ kind: "idle", error: t("startError") });
    }
  }, [roomId, currentUserId, t]);

  return (
    <main
      data-testid="calibration-view"
      className="flex min-h-screen flex-col items-center px-4 py-8"
    >
      <div className="max-w-xl w-full space-y-6 motion-safe:animate-fade-in">
        <header className="space-y-2 text-center">
          <h1 className="text-xl font-bold tracking-tight emx-wordmark">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          {firstAnnouncerName ? (
            <p
              data-testid="calibration-first-announcer"
              className="text-base font-medium"
            >
              {t("firstAnnouncer", { name: firstAnnouncerName })}
            </p>
          ) : null}
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("yourPicksHeading")}
          </h2>
          {ownBreakdown ? (
            <UserPicksList
              picks={ownBreakdown.picks}
              contestants={contestants}
            />
          ) : (
            <p
              data-testid="calibration-empty"
              className="text-sm italic text-muted-foreground"
            >
              {t("noPicks")}
            </p>
          )}
        </section>

        {isOwner ? (
          <div className="space-y-2">
            <button
              type="button"
              data-testid="calibration-start-button"
              onClick={handleStart}
              disabled={startState.kind === "submitting"}
              className="w-full rounded-xl bg-primary px-6 py-5 text-lg font-semibold text-primary-foreground transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
            >
              {startState.kind === "submitting"
                ? t("startBusy")
                : t("startButton")}
            </button>
            {startState.error ? (
              <p role="alert" className="text-sm text-destructive">
                {startState.error}
              </p>
            ) : null}
          </div>
        ) : (
          <p
            data-testid="calibration-waiting-for-owner"
            className="text-center text-sm text-muted-foreground"
          >
            {t("waitingForOwner")}
          </p>
        )}
      </div>
    </main>
  );
}
