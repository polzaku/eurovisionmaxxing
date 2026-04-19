"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/ui/Avatar";
import AvatarCarousel from "@/components/onboarding/AvatarCarousel";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { generateCarouselSeeds } from "@/lib/onboarding/seeds";
import { sanitizeNextPath } from "@/lib/onboarding/safeNext";
import { DISPLAY_NAME_REGEX } from "@/lib/auth/onboard";
import { createExpiryDate, getSession, setSession } from "@/lib/session";

const DEFAULT_SEED = "emx-default";
const NAME_DEBOUNCE_MS = 300;

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function browserRng(): number {
  return Math.random();
}

interface OnboardResponse {
  userId: string;
  rejoinToken: string;
  displayName: string;
  avatarSeed: string;
}

interface ApiErrorShape {
  error: { code: string; message: string; field?: string };
}

export default function OnboardingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(
    () => sanitizeNextPath(searchParams.get("next")),
    [searchParams],
  );

  const [redirectChecked, setRedirectChecked] = useState(false);
  useEffect(() => {
    if (getSession()) {
      router.replace(nextPath);
      return;
    }
    setRedirectChecked(true);
  }, [router, nextPath]);

  const [name, setName] = useState("");
  const debouncedName = useDebouncedValue(name, NAME_DEBOUNCE_MS);

  const [carouselOpen, setCarouselOpen] = useState(false);
  const [carouselSeeds, setCarouselSeeds] = useState<string[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<string | null>(null);
  const [previewSeed, setPreviewSeed] = useState<string>(DEFAULT_SEED);

  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (carouselOpen) return;
    const normalized = normalizeName(debouncedName);
    setPreviewSeed(normalized.length > 0 ? normalized : DEFAULT_SEED);
  }, [debouncedName, carouselOpen]);

  const effectiveSeed = selectedSeed ?? previewSeed;

  function openOrShuffleCarousel() {
    const seeds = generateCarouselSeeds(effectiveSeed, browserRng);
    setCarouselSeeds(seeds);
    setSelectedSeed(effectiveSeed);
    setCarouselOpen(true);
  }

  function onPickTile(seed: string) {
    setSelectedSeed(seed);
  }

  const normalized = normalizeName(name);
  const nameValid = DISPLAY_NAME_REGEX.test(normalized);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setGeneralError(null);
    if (!nameValid) {
      setFieldError("Use 2–24 letters, numbers, spaces, or hyphens.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: normalized,
          avatarSeed: effectiveSeed,
        }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as OnboardResponse;
        setSession({
          userId: data.userId,
          rejoinToken: data.rejoinToken,
          displayName: data.displayName,
          avatarSeed: data.avatarSeed,
          expiresAt: createExpiryDate(),
        });
        router.push(nextPath);
        return;
      }
      const body = (await res.json().catch(() => null)) as ApiErrorShape | null;
      if (res.status === 400 && body?.error?.code === "INVALID_DISPLAY_NAME") {
        setFieldError(body.error.message);
      } else {
        setGeneralError("Couldn't create your identity. Try again.");
      }
    } catch {
      setGeneralError("Couldn't create your identity. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!redirectChecked) {
    return null;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-md space-y-8 px-6 py-10 animate-fade-in"
    >
      <div className="flex flex-col items-center space-y-4">
        <button
          type="button"
          onClick={openOrShuffleCarousel}
          aria-label="Change avatar"
          className="rounded-full border-2 border-border p-1 transition-colors hover:border-accent"
        >
          <Avatar seed={effectiveSeed} size={128} />
        </button>
        <p className="text-sm text-muted-foreground">Tap your avatar to change it.</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="displayName" className="text-sm font-semibold text-foreground">
          Your display name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={24}
          aria-invalid={fieldError != null}
          aria-describedby={fieldError ? "displayName-error" : undefined}
          className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          placeholder="e.g. Alice"
        />
        {fieldError && (
          <p
            id="displayName-error"
            role="alert"
            aria-live="polite"
            className="text-sm text-hot-pink"
          >
            {fieldError}
          </p>
        )}
      </div>

      {carouselOpen && (
        <AvatarCarousel
          seeds={carouselSeeds}
          selectedSeed={effectiveSeed}
          onSelect={onPickTile}
          onShuffle={openOrShuffleCarousel}
        />
      )}

      {generalError && (
        <p role="alert" aria-live="polite" className="text-sm text-hot-pink">
          {generalError}
        </p>
      )}

      <button
        type="submit"
        disabled={!nameValid || submitting}
        className="block w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
      >
        {submitting ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
