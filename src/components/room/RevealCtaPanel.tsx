"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { nextRevealCtaState } from "@/components/voting/nextRevealCtaState";
import Button from "@/components/ui/Button";

export interface RevealCtaPanelProps {
  readyCount: number;
  totalCount: number;
  firstReadyAt: string | null;
  onReveal: () => Promise<void>;
}

const TICK_MS = 250;

export default function RevealCtaPanel({
  readyCount,
  totalCount,
  firstReadyAt,
  onReveal,
}: RevealCtaPanelProps) {
  const t = useTranslations();
  const [now, setNow] = useState(() => Date.now());
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const cta = nextRevealCtaState({
    readyCount,
    totalCount,
    firstReadyAt: firstReadyAt ? Date.parse(firstReadyAt) : null,
    now,
  });

  const handleReveal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onReveal();
    } finally {
      setBusy(false);
      setOverrideOpen(false);
    }
  };

  let anywayLabel: string;
  if (cta.anywayLabel.kind === "halfReady") {
    anywayLabel = t("instantAnnounce.admin.revealAnywayHalf", {
      ready: cta.anywayLabel.readyCount,
      total: cta.anywayLabel.totalCount,
    });
  } else if (cta.anywayLabel.kind === "countdown") {
    const total = cta.anywayLabel.secondsRemaining;
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, "0");
    anywayLabel = t("instantAnnounce.admin.revealAnywayCountdown", {
      minutes,
      seconds,
    });
  } else {
    anywayLabel = t("instantAnnounce.admin.revealAnyway");
  }

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <Button
        variant="primary"
        disabled={!cta.canRevealAll || busy}
        onClick={handleReveal}
        className="w-full"
      >
        {t("instantAnnounce.admin.revealAll")}
      </Button>
      <Button
        variant="ghost"
        disabled={!cta.canRevealAnyway || busy}
        onClick={handleReveal}
        className="w-full"
      >
        {anywayLabel}
      </Button>
      <button
        type="button"
        onClick={() => setOverrideOpen(true)}
        disabled={busy}
        className="w-full text-sm text-destructive hover:underline"
      >
        {t("instantAnnounce.admin.override")}
      </button>

      {overrideOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="override-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOverrideOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-sm m-4 bg-background rounded-xl border border-border p-6 space-y-4">
            <h2 id="override-confirm-title" className="text-lg font-bold">
              {t("instantAnnounce.admin.overrideConfirmTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("instantAnnounce.admin.overrideConfirmBody")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setOverrideOpen(false)}
                disabled={busy}
              >
                {t("instantAnnounce.admin.overrideConfirmCancel")}
              </Button>
              <Button
                variant="primary"
                onClick={handleReveal}
                disabled={busy}
              >
                {t("instantAnnounce.admin.overrideConfirmGo")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
