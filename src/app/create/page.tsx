"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getSession } from "@/lib/session";
import { VOTING_TEMPLATES } from "@/lib/templates";
import {
  fetchContestantsPreview,
  createRoomApi,
  type ContestantsPreview,
} from "@/lib/create/api";
import { mapCreateError } from "@/lib/create/errors";
import EventSelection from "@/components/create/EventSelection";
import VotingConfig from "@/components/create/VotingConfig";

type Step = 1 | 2;
type Event = "semi1" | "semi2" | "final";
type TemplateId = "classic" | "spectacle" | "bangerTest" | "custom";
type Mode = "live" | "instant";

interface ContestantsState {
  kind: "idle" | "loading" | "slow" | "ready" | "error" | "timeout";
  count?: number;
  preview?: Array<{ flag: string; country: string }>;
  errorMessage?: string;
}

/**
 * SPEC §5.1e timing constants — exported for tests. The wizard
 * debounces year/event input by 300ms (avoid firing per-keystroke),
 * shows a "this is taking a while" hint at 5s, and hard-cuts the fetch
 * at 10s so a hung upstream doesn't render a forever-loading wizard.
 */
const DEBOUNCE_MS = 300;
const SLOW_THRESHOLD_MS = 5_000;
const HARD_TIMEOUT_MS = 10_000;

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

const MIN_YEAR = 2000;

export default function CreateRoomPage() {
  const router = useRouter();
  const t = useTranslations();
  const maxYear = new Date().getUTCFullYear();

  // Session guard — existing pattern across /join and /room/[id].
  useEffect(() => {
    if (getSession()) return;
    router.replace("/onboard?next=/create");
  }, [router]);

  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [year, setYear] = useState<number>(maxYear);
  const [event, setEvent] = useState<Event>("final");
  const [contestants, setContestants] = useState<ContestantsState>({
    kind: "idle",
  });

  // Step 2 state
  const [templateId, setTemplateId] = useState<TemplateId>("classic");
  const [customCategories, setCustomCategories] = useState<string[]>([""]);
  // Eurovision-authentic defaults: live mode with the short reveal style
  // pre-selected (SPEC §10.2.2). Admins can still pick Full or Instant.
  const [announcementMode, setAnnouncementMode] = useState<Mode>("live");
  const [announcementStyle, setAnnouncementStyle] = useState<'full' | 'short'>('short');
  const [allowNowPerforming, setAllowNowPerforming] = useState<boolean>(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  // SPEC §5.1e — debounced fetch with slow-state cue + hard timeout
  // + abort-on-input-change so a slow upstream doesn't render a forever
  // -loading wizard or stale results from a previous year/event.
  useEffect(() => {
    setContestants({ kind: "loading" });
    const controller = new AbortController();
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const debounce = setTimeout(async () => {
      // Once the debounce fires, set up the slow + hard-timeout
      // markers so the user sees feedback when the network is sluggish.
      slowTimer = setTimeout(() => {
        if (controller.signal.aborted) return;
        // Only escalate to "slow" if we're still loading (not already
        // ready/error). Use the functional updater to avoid a stale
        // closure on `contestants`.
        setContestants((prev) =>
          prev.kind === "loading" ? { ...prev, kind: "slow" } : prev,
        );
      }, SLOW_THRESHOLD_MS);

      timeoutTimer = setTimeout(() => {
        if (controller.signal.aborted) return;
        controller.abort();
        setContestants({
          kind: "timeout",
          errorMessage: mapCreateError("TIMEOUT"),
        });
      }, HARD_TIMEOUT_MS);

      const result = await fetchContestantsPreview(
        year,
        event,
        { fetch: window.fetch.bind(window) },
        { signal: controller.signal },
      );

      // Discard responses arriving after the controller was aborted —
      // either due to year/event change mid-flight or our own hard
      // timeout firing first.
      if (controller.signal.aborted) return;

      if (slowTimer) clearTimeout(slowTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      if (result.ok) {
        const data = result.data as ContestantsPreview;
        setContestants({
          kind: "ready",
          count: data.count,
          preview: data.preview,
        });
      } else if (result.code === "ABORTED") {
        // No-op — handled by the signal.aborted guard above. Defensive
        // catch in case the timing shifts.
      } else {
        setContestants({
          kind: "error",
          errorMessage:
            result.code === "CONTEST_DATA_NOT_FOUND"
              ? t("create.eventSelection.error")
              : mapCreateError(result.code),
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(debounce);
      if (slowTimer) clearTimeout(slowTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      controller.abort();
    };
  }, [year, event, t]);

  const isCustomValid = useCallback((rows: string[]): boolean => {
    if (rows.length < 1 || rows.length > 8) return false;
    const trimmed = rows.map((r) => r.trim().toLowerCase());
    if (new Set(trimmed).size !== trimmed.length) return false;
    return rows.every((r) =>
      /^[A-Za-z0-9 \-]{2,24}$/.test(r.trim()),
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    const session = getSession();
    if (!session) {
      router.replace("/onboard?next=/create");
      return;
    }
    let categories;
    if (templateId === "custom") {
      if (!isCustomValid(customCategories)) {
        setSubmitState({
          kind: "error",
          message: mapCreateError("INVALID_CATEGORIES"),
        });
        return;
      }
      categories = customCategories.map((name) => ({
        name: name.trim(),
        weight: 1,
      }));
    } else {
      const template = VOTING_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        setSubmitState({
          kind: "error",
          message: mapCreateError("INVALID_CATEGORIES"),
        });
        return;
      }
      categories = template.categories;
    }
    setSubmitState({ kind: "submitting" });
    const result = await createRoomApi(
      {
        year,
        event,
        categories,
        announcementMode,
        announcementStyle,
        allowNowPerforming,
        userId: session.userId,
      },
      { fetch: window.fetch.bind(window) }
    );
    if (result.ok) {
      // T1 (SPEC §6.1): no Step 3 page — go straight to the lobby, which
      // surfaces PIN, QR, share link, and Start-voting for the admin.
      router.push(`/room/${result.room.id}`);
      return;
    }
    setSubmitState({
      kind: "error",
      message: mapCreateError(result.code),
    });
  }, [
    year,
    event,
    templateId,
    customCategories,
    isCustomValid,
    announcementMode,
    announcementStyle,
    allowNowPerforming,
    router,
  ]);

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="max-w-md w-full space-y-6 animate-fade-in">
        <header className="space-y-1 text-center">
          <h1 className="text-3xl font-bold tracking-tight emx-wordmark">
            {t("create.title")}
          </h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("create.stepIndicator", { step })}
          </p>
        </header>

        {step === 1 && (
          <EventSelection
            year={year}
            event={event}
            contestants={contestants}
            minYear={MIN_YEAR}
            maxYear={maxYear}
            extraYears={
              process.env.NODE_ENV !== "production" ? [9999] : undefined
            }
            onChange={(patch) => {
              if (patch.year !== undefined) setYear(patch.year);
              if (patch.event !== undefined) setEvent(patch.event);
            }}
            onNext={() => setStep(2)}
            onBack={() => router.push("/")}
          />
        )}

        {step === 2 && (
          <VotingConfig
            templateId={templateId}
            customCategories={customCategories}
            announcementMode={announcementMode}
            announcementStyle={announcementStyle}
            allowNowPerforming={allowNowPerforming}
            submitState={submitState}
            onChange={(patch) => {
              if (patch.templateId !== undefined)
                setTemplateId(patch.templateId);
              if (patch.customCategories !== undefined)
                setCustomCategories(patch.customCategories);
              if (patch.announcementMode !== undefined)
                setAnnouncementMode(patch.announcementMode);
              if (patch.announcementStyle !== undefined)
                setAnnouncementStyle(patch.announcementStyle);
              if (patch.allowNowPerforming !== undefined)
                setAllowNowPerforming(patch.allowNowPerforming);
            }}
            onBack={() => setStep(1)}
            onSubmit={() => void handleSubmit()}
          />
        )}
      </div>
    </main>
  );
}
