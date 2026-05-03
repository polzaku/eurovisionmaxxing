"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export interface RefreshDiff {
  added: string[];
  removed: string[];
  reordered: string[];
}

interface RefreshContestantsButtonProps {
  /**
   * Triggers a server-side refresh. Resolves with the diff arrays the
   * caller computed by comparing the prior contestant list to the fresh
   * one returned by `refreshContestantsApi`. Resolves with `null` on
   * fail (auth, network, upstream) — the button renders an error status.
   */
  onRefresh: () => Promise<RefreshDiff | null>;
}

const COOLDOWN_MS = 30_000;

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; diff: RefreshDiff }
  | { kind: "error" };

/**
 * SPEC §5.1d admin "Refresh contestants" button. Owns the in-flight + 30 s
 * cooldown state and renders an inline status line summarising the diff
 * (added/removed/reordered counts) — or "Already up to date." if nothing
 * changed. The 30 s cooldown after success is the MVP rate-limit; server
 * side has no enforcement (deferred to V2 — see refreshContestants.ts JSDoc).
 */
export default function RefreshContestantsButton({
  onRefresh,
}: RefreshContestantsButtonProps) {
  const t = useTranslations();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (cooldownUntil === null) return;
    cooldownTimerRef.current = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, [cooldownUntil]);

  const inCooldown = cooldownUntil !== null && now < cooldownUntil;
  const disabled = status.kind === "busy" || inCooldown;

  const handleClick = async () => {
    if (disabled) return;
    setStatus({ kind: "busy" });
    const result = await onRefresh();
    if (!result) {
      setStatus({ kind: "error" });
      return;
    }
    setStatus({ kind: "ok", diff: result });
    setCooldownUntil(Date.now() + COOLDOWN_MS);
    setNow(Date.now());
  };

  let label: string;
  if (status.kind === "busy") {
    label = t("lobby.refreshContestants.busy");
  } else {
    label = t("lobby.refreshContestants.button");
  }

  let statusLine: string | null = null;
  if (status.kind === "ok") {
    const { added, removed, reordered } = status.diff;
    if (added.length === 0 && removed.length === 0 && reordered.length === 0) {
      statusLine = t("lobby.refreshContestants.upToDate");
    } else {
      statusLine = t("lobby.refreshContestants.summary", {
        added: added.length,
        removed: removed.length,
        reordered: reordered.length,
      });
    }
  } else if (status.kind === "error") {
    statusLine = t("lobby.refreshContestants.error");
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="w-full rounded-xl border-2 border-border px-4 py-2 text-sm font-medium transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:active:scale-100"
      >
        {label}
      </button>
      {statusLine ? (
        <p
          role="status"
          className="text-xs text-muted-foreground text-center"
        >
          {statusLine}
        </p>
      ) : null}
    </div>
  );
}
