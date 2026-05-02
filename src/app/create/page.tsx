"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
type TemplateId = "classic" | "spectacle" | "bangerTest";
type Mode = "live" | "instant";

interface ContestantsState {
  kind: "idle" | "loading" | "ready" | "error";
  count?: number;
  preview?: Array<{ flag: string; country: string }>;
  errorMessage?: string;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

const MIN_YEAR = 2000;

export default function CreateRoomPage() {
  const router = useRouter();
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
  const [announcementMode, setAnnouncementMode] = useState<Mode>("instant");
  const [allowNowPerforming, setAllowNowPerforming] = useState<boolean>(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  // Debounced contestants preview fetch on year/event change.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setContestants({ kind: "loading" });
    debounceRef.current = setTimeout(async () => {
      const result = await fetchContestantsPreview(year, event, {
        fetch: window.fetch.bind(window),
      });
      if (result.ok) {
        const data = result.data as ContestantsPreview;
        setContestants({
          kind: "ready",
          count: data.count,
          preview: data.preview,
        });
      } else {
        setContestants({
          kind: "error",
          errorMessage:
            result.code === "CONTEST_DATA_NOT_FOUND"
              ? "We couldn't load contestant data for this event. Try a different year or event."
              : mapCreateError(result.code),
        });
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [year, event]);

  const handleSubmit = useCallback(async () => {
    const session = getSession();
    if (!session) {
      router.replace("/onboard?next=/create");
      return;
    }
    const template = VOTING_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      setSubmitState({
        kind: "error",
        message: mapCreateError("INVALID_CATEGORIES"),
      });
      return;
    }
    setSubmitState({ kind: "submitting" });
    const result = await createRoomApi(
      {
        year,
        event,
        categories: template.categories,
        announcementMode,
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
    announcementMode,
    allowNowPerforming,
    router,
  ]);

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="max-w-md w-full space-y-6 animate-fade-in">
        <header className="space-y-1 text-center">
          <h1 className="text-3xl font-bold tracking-tight emx-wordmark">
            Create a Room
          </h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Step {step} of 2
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
          />
        )}

        {step === 2 && (
          <VotingConfig
            templateId={templateId}
            announcementMode={announcementMode}
            allowNowPerforming={allowNowPerforming}
            submitState={submitState}
            onChange={(patch) => {
              if (patch.templateId !== undefined)
                setTemplateId(patch.templateId);
              if (patch.announcementMode !== undefined)
                setAnnouncementMode(patch.announcementMode);
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
