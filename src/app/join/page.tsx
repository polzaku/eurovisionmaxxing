"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PinInput from "@/components/ui/PinInput";
import { getSession } from "@/lib/session";
import { mapJoinError } from "@/lib/join/errors";
import {
  stashPendingPin,
  readPendingPin,
  clearPendingPin,
} from "@/lib/join/pendingPin";
import { submitPinToApi } from "@/lib/join/submitPin";

type UiState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export default function JoinPage() {
  const router = useRouter();
  const [ui, setUi] = useState<UiState>({ kind: "idle" });
  const [resumePin, setResumePin] = useState<string | null>(null);

  async function submit(pin: string): Promise<void> {
    const session = getSession();
    if (!session) {
      stashPendingPin(window.sessionStorage, pin);
      router.push("/onboard?next=/join");
      return;
    }
    setUi({ kind: "submitting" });
    const result = await submitPinToApi(
      { pin, userId: session.userId },
      { fetch: window.fetch.bind(window) }
    );
    if (result.ok) {
      router.push(`/room/${result.roomId}`);
      return;
    }
    setUi({ kind: "error", message: mapJoinError(result.code) });
  }

  // On mount: run the four-case decision table (session × pending PIN).
  useEffect(() => {
    const session = getSession();
    const pending = readPendingPin(window.sessionStorage);
    if (pending) {
      clearPendingPin(window.sessionStorage);
    }
    if (session && pending) {
      setResumePin(pending);
      void submit(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-6 text-center animate-fade-in">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight emx-wordmark">
            Join a Room
          </h1>
          <p className="text-muted-foreground">
            Enter the 6-character room PIN to join.
          </p>
        </div>
        <PinInput
          onComplete={(pin) => void submit(pin)}
          disabled={ui.kind === "submitting"}
          initialValue={resumePin ?? undefined}
        />
        {ui.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {ui.message}
          </p>
        )}
      </div>
    </main>
  );
}
