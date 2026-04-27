"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";
import Button from "@/components/ui/Button";
import InstantOwnBreakdown, {
  type OwnBreakdownEntry,
} from "@/components/room/InstantOwnBreakdown";
import RevealCtaPanel from "@/components/room/RevealCtaPanel";

export interface InstantAnnouncingMember {
  userId: string;
  displayName: string;
  isReady: boolean;
  readyAt: string | null;
}

export interface InstantAnnouncingViewProps {
  room: { id: string; ownerUserId: string };
  contestants: Contestant[];
  memberships: InstantAnnouncingMember[];
  currentUserId: string;
  ownBreakdown: OwnBreakdownEntry[];
  onMarkReady: () => Promise<void>;
  onReveal: () => Promise<void>;
}

export default function InstantAnnouncingView({
  room,
  contestants,
  memberships,
  currentUserId,
  ownBreakdown,
  onMarkReady,
  onReveal,
}: InstantAnnouncingViewProps) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);

  const isAdmin = currentUserId === room.ownerUserId;
  const ownIsReady = useMemo(
    () =>
      memberships.find((m) => m.userId === currentUserId)?.isReady ?? false,
    [memberships, currentUserId],
  );
  const readyCount = memberships.filter((m) => m.isReady).length;
  const totalCount = memberships.length;
  const firstReadyAt = useMemo(() => {
    const readyAts = memberships
      .filter((m) => m.isReady && m.readyAt)
      .map((m) => m.readyAt!)
      .sort();
    return readyAts[0] ?? null;
  }, [memberships]);

  const handleReady = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onMarkReady();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("instantAnnounce.admin.readyCount", {
              ready: readyCount,
              total: totalCount,
            })}
          </p>
        </header>

        <InstantOwnBreakdown
          entries={ownBreakdown}
          contestants={contestants}
        />

        {ownIsReady ? (
          <p className="text-sm text-muted-foreground text-center">
            {t("instantAnnounce.ready.waiting", {
              count: Math.max(0, totalCount - readyCount),
            })}
          </p>
        ) : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={handleReady}
            className="w-full"
          >
            {busy
              ? t("instantAnnounce.ready.busy")
              : t("instantAnnounce.ready.button")}
          </Button>
        )}

        {isAdmin && (
          <RevealCtaPanel
            readyCount={readyCount}
            totalCount={totalCount}
            firstReadyAt={firstReadyAt}
            onReveal={onReveal}
          />
        )}
      </div>
    </main>
  );
}
