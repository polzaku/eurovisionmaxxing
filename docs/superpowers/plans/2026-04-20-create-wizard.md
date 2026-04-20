# /create 3-step wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/create` stub with a functional 3-step wizard (event selection → voting config → PIN + QR + share link), per `docs/superpowers/specs/2026-04-20-create-wizard-design.md`. Closes the last Phase 2 item and the full host flow: landing → onboard → create → lobby → Start voting.

**Architecture:** Two pure client helpers under `src/lib/create/` (fetch wrappers + error mapping, DI-style, unit-tested). Three pure presentational components under `src/components/create/`. The `/create/page.tsx` owns wizard state via `useState`, composes the components, handles session-guard + debounced contestant-preview fetching.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Vitest. Client-side QR generation via the already-installed `qrcode` package. No new runtime deps.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/create/api.ts` | **new** | `fetchContestantsPreview`, `createRoomApi` — client fetch wrappers, tagged-union result |
| `src/lib/create/api.test.ts` | **new** | Mocked-fetch unit tests |
| `src/lib/create/errors.ts` | **new** | `mapCreateError(code)` table |
| `src/lib/create/errors.test.ts` | **new** | Table test |
| `src/components/create/EventSelection.tsx` | **new** | Step 1: year dropdown, event radio cards, contestant preview |
| `src/components/create/VotingConfig.tsx` | **new** | Step 2: template cards (with inline bullets), mode radio, now-performing toggle |
| `src/components/create/RoomReady.tsx` | **new** | Step 3: PIN + QR + copy buttons + Start lobby CTA |
| `src/app/create/page.tsx` | modify | Orchestrator: session guard + wizard state machine + debounced preview fetch |

---

## Task 1: `mapCreateError` helper

**Files:**
- Create: `src/lib/create/errors.ts`
- Create: `src/lib/create/errors.test.ts`

- [ ] **Step 1.1: Write the failing test (RED)**

Create `src/lib/create/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapCreateError } from "@/lib/create/errors";

describe("mapCreateError", () => {
  it.each([
    ["INVALID_YEAR", "That year isn't available. Try a different one."],
    ["INVALID_EVENT", "That event isn't available for this year."],
    ["INVALID_CATEGORIES", "Something's off with the category setup."],
    ["INVALID_CATEGORY", "One of the categories isn't valid."],
    ["INVALID_ANNOUNCEMENT_MODE", "Pick Live or Instant announcement mode."],
    ["INVALID_USER_ID", "Your session is invalid. Please re-onboard."],
    ["INVALID_BODY", "Something went wrong. Please try again."],
    ["INTERNAL_ERROR", "We hit a snag on our end. Please try again in a moment."],
    ["NETWORK", "We couldn't reach the server. Check your connection."],
  ])("maps %s to the expected message", (code, expected) => {
    expect(mapCreateError(code)).toBe(expected);
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(mapCreateError("SOMETHING_ELSE")).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("falls back when code is undefined", () => {
    expect(mapCreateError(undefined)).toBe(
      "Something went wrong. Please try again."
    );
  });
});
```

- [ ] **Step 1.2: Run test — verify RED**

Run: `npx vitest run src/lib/create/errors.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 1.3: Implement (GREEN)**

Create `src/lib/create/errors.ts`:

```ts
const MESSAGES: Record<string, string> = {
  INVALID_YEAR: "That year isn't available. Try a different one.",
  INVALID_EVENT: "That event isn't available for this year.",
  INVALID_CATEGORIES: "Something's off with the category setup.",
  INVALID_CATEGORY: "One of the categories isn't valid.",
  INVALID_ANNOUNCEMENT_MODE: "Pick Live or Instant announcement mode.",
  INVALID_USER_ID: "Your session is invalid. Please re-onboard.",
  INVALID_BODY: "Something went wrong. Please try again.",
  INTERNAL_ERROR: "We hit a snag on our end. Please try again in a moment.",
  NETWORK: "We couldn't reach the server. Check your connection.",
};

const GENERIC = "Something went wrong. Please try again.";

export function mapCreateError(code: string | undefined): string {
  if (!code) return GENERIC;
  return MESSAGES[code] ?? GENERIC;
}
```

- [ ] **Step 1.4: Run test — verify GREEN**

Run: `npx vitest run src/lib/create/errors.test.ts`
Expected: PASS (11/11).

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/create/errors.ts src/lib/create/errors.test.ts
git commit -m "Add mapCreateError helper for /create wizard"
```

---

## Task 2: `fetchContestantsPreview` + `createRoomApi` helpers

**Files:**
- Create: `src/lib/create/api.ts`
- Create: `src/lib/create/api.test.ts`

- [ ] **Step 2.1: Write the failing tests (RED)**

Create `src/lib/create/api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  fetchContestantsPreview,
  createRoomApi,
} from "@/lib/create/api";

const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchContestantsPreview", () => {
  it("GETs /api/contestants?year&event and returns { ok, data }", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        contestants: [
          { country: "Norway", flagEmoji: "🇳🇴" },
          { country: "Serbia", flagEmoji: "🇷🇸" },
          { country: "Denmark", flagEmoji: "🇩🇰" },
          { country: "Germany", flagEmoji: "🇩🇪" },
        ],
      })
    ) as unknown as typeof globalThis.fetch;

    const result = await fetchContestantsPreview(2025, "final", {
      fetch: fetchSpy,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        count: 4,
        preview: [
          { flag: "🇳🇴", country: "Norway" },
          { flag: "🇷🇸", country: "Serbia" },
          { flag: "🇩🇰", country: "Denmark" },
        ],
      },
    });
    const [url] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("/api/contestants?year=2025&event=final");
  });

  it("returns { ok: false, code } on 404", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(404, { error: "Contest data not found" })
    ) as unknown as typeof globalThis.fetch;
    const result = await fetchContestantsPreview(2026, "final", {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "CONTEST_DATA_NOT_FOUND" });
  });

  it("returns code NETWORK when fetch throws", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const result = await fetchContestantsPreview(2025, "final", {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
  });
});

describe("createRoomApi", () => {
  const validInput = {
    year: 2025,
    event: "final" as const,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "instant" as const,
    allowNowPerforming: false,
    userId: VALID_USER_ID,
  };

  it("POSTs /api/rooms with body; returns { ok: true, room } on 201", async () => {
    const fakeRoom = {
      id: "room-123",
      pin: "AAAAAA",
      year: 2025,
      event: "final",
      categories: [{ name: "Vocals", weight: 1 }],
      ownerUserId: VALID_USER_ID,
      status: "lobby",
      announcementMode: "instant",
      announcementOrder: null,
      announcingUserId: null,
      currentAnnounceIdx: 0,
      nowPerformingId: null,
      allowNowPerforming: false,
      createdAt: "2026-04-20T00:00:00Z",
    };
    const fetchSpy = vi.fn(async () =>
      jsonResponse(201, { room: fakeRoom })
    ) as unknown as typeof globalThis.fetch;

    const result = await createRoomApi(validInput, { fetch: fetchSpy });
    expect(result).toEqual({ ok: true, room: fakeRoom });
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("/api/rooms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      year: 2025,
      event: "final",
      categories: [{ name: "Vocals", weight: 1 }],
      announcementMode: "instant",
      allowNowPerforming: false,
      userId: VALID_USER_ID,
    });
  });

  it("returns { ok: false, code, field } on 400 INVALID_YEAR", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(400, {
        error: {
          code: "INVALID_YEAR",
          field: "year",
          message: "bad year",
        },
      })
    ) as unknown as typeof globalThis.fetch;
    const result = await createRoomApi(validInput, { fetch: fetchSpy });
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_YEAR",
      field: "year",
      message: "bad year",
    });
  });

  it("returns { ok: false, code: INTERNAL_ERROR } on 500 unparseable body", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof globalThis.fetch;
    const result = await createRoomApi(validInput, { fetch: fetchSpy });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });

  it("returns { ok: false, code: NETWORK } when fetch throws", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const result = await createRoomApi(validInput, { fetch: fetchSpy });
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
  });
});
```

- [ ] **Step 2.2: Run tests — verify RED**

Run: `npx vitest run src/lib/create/api.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 2.3: Implement (GREEN)**

Create `src/lib/create/api.ts`:

```ts
import type { Room, VotingCategory } from "@/types";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

interface Deps {
  fetch: typeof globalThis.fetch;
}

export interface ContestantsPreview {
  count: number;
  preview: Array<{ flag: string; country: string }>;
}

interface ApiContestantsResponse {
  contestants?: Array<{ country?: string; flagEmoji?: string }>;
  error?: string;
}

export async function fetchContestantsPreview(
  year: number,
  event: "semi1" | "semi2" | "final",
  deps: Deps
): Promise<
  | { ok: true; data: ContestantsPreview }
  | { ok: false; code: string; message: string }
> {
  let res: Response;
  try {
    res = await deps.fetch(`/api/contestants?year=${year}&event=${event}`);
  } catch {
    return { ok: false, code: "NETWORK", message: GENERIC_MESSAGE };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as ApiContestantsResponse;
      const contestants = body.contestants ?? [];
      const preview = contestants.slice(0, 3).map((c) => ({
        flag: c.flagEmoji ?? "",
        country: c.country ?? "",
      }));
      return { ok: true, data: { count: contestants.length, preview } };
    } catch {
      return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
    }
  }

  // The /api/contestants route returns `{ error: <string> }` on failure
  // (not the structured { error: {code, message} } shape of other routes).
  // Map a 404 to a stable code so the wizard can display a helpful message.
  if (res.status === 404) {
    return {
      ok: false,
      code: "CONTEST_DATA_NOT_FOUND",
      message:
        "We couldn't load contestant data for this event. Try a different year or event.",
    };
  }
  return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
}

export interface CreateRoomApiInput {
  year: number;
  event: "semi1" | "semi2" | "final";
  categories: VotingCategory[];
  announcementMode: "live" | "instant";
  allowNowPerforming: boolean;
  userId: string;
}

export async function createRoomApi(
  input: CreateRoomApiInput,
  deps: Deps
): Promise<
  | { ok: true; room: Room }
  | { ok: false; code: string; field?: string; message: string }
> {
  let res: Response;
  try {
    res = await deps.fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, code: "NETWORK", message: GENERIC_MESSAGE };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as { room?: Room };
      if (body.room) return { ok: true, room: body.room };
    } catch {
      // fall through
    }
    return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
  }

  try {
    const body = (await res.json()) as {
      error?: { code?: string; field?: string; message?: string };
    };
    const err = body.error ?? {};
    return {
      ok: false,
      code: err.code ?? "INTERNAL_ERROR",
      message: err.message ?? GENERIC_MESSAGE,
      ...(err.field ? { field: err.field } : {}),
    };
  } catch {
    return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
  }
}
```

- [ ] **Step 2.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/create/api.test.ts`
Expected: PASS (7/7).

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/create/api.ts src/lib/create/api.test.ts
git commit -m "Add fetchContestantsPreview + createRoomApi client helpers"
```

---

## Task 3: `EventSelection` component

**Files:**
- Create: `src/components/create/EventSelection.tsx`

No automated tests (consistent with prior UI work). Validated via manual smoke in Task 7.

- [ ] **Step 3.1: Create the component**

Create `src/components/create/EventSelection.tsx`:

```tsx
"use client";

import Button from "@/components/ui/Button";

type Event = "semi1" | "semi2" | "final";

interface ContestantsState {
  kind: "idle" | "loading" | "ready" | "error";
  count?: number;
  preview?: Array<{ flag: string; country: string }>;
  errorMessage?: string;
}

interface EventSelectionProps {
  year: number;
  event: Event;
  contestants: ContestantsState;
  minYear: number;
  maxYear: number;
  onChange: (patch: { year?: number; event?: Event }) => void;
  onNext: () => void;
}

const EVENT_LABELS: Record<Event, string> = {
  semi1: "Semi-Final 1",
  semi2: "Semi-Final 2",
  final: "Grand Final",
};

export default function EventSelection({
  year,
  event,
  contestants,
  minYear,
  maxYear,
  onChange,
  onNext,
}: EventSelectionProps) {
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  const canProceed = contestants.kind === "ready";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">Pick an event</h2>
        <p className="text-sm text-muted-foreground">
          Which Eurovision event are you watching?
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="year" className="text-sm font-medium">
          Year
        </label>
        <select
          id="year"
          value={year}
          onChange={(e) => onChange({ year: parseInt(e.target.value, 10) })}
          className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-base focus:outline-none focus:border-primary"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Event</p>
        <div className="grid grid-cols-1 gap-2">
          {(Object.keys(EVENT_LABELS) as Event[]).map((ev) => {
            const selected = ev === event;
            return (
              <button
                key={ev}
                type="button"
                onClick={() => onChange({ event: ev })}
                className={`text-left rounded-lg border-2 px-4 py-3 transition-all ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-accent"
                }`}
              >
                <span className="font-semibold">{EVENT_LABELS[ev]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-[2.5rem]">
        {contestants.kind === "loading" && (
          <p className="text-sm text-muted-foreground animate-shimmer">
            Loading contestants&hellip;
          </p>
        )}
        {contestants.kind === "ready" && (
          <p className="text-sm">
            <span className="font-semibold">{contestants.count}</span> countries
            loaded
            {contestants.preview && contestants.preview.length > 0 && (
              <>
                {" "}
                &middot;{" "}
                <span className="text-muted-foreground">
                  {contestants.preview
                    .map((c) => `${c.flag} ${c.country}`)
                    .join(" &middot; ")}
                  {contestants.count && contestants.count > 3 ? ", …" : ""}
                </span>
              </>
            )}
          </p>
        )}
        {contestants.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {contestants.errorMessage ??
              "We couldn't load contestant data for this event."}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canProceed}>
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3.2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3.3: Commit**

```bash
git add src/components/create/EventSelection.tsx
git commit -m "Add EventSelection component for /create Step 1"
```

---

## Task 4: `VotingConfig` component

**Files:**
- Create: `src/components/create/VotingConfig.tsx`

- [ ] **Step 4.1: Create the component**

Create `src/components/create/VotingConfig.tsx`:

```tsx
"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { VOTING_TEMPLATES } from "@/lib/templates";

type TemplateId = "classic" | "spectacle" | "banger";
type Mode = "live" | "instant";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

interface VotingConfigProps {
  templateId: TemplateId;
  announcementMode: Mode;
  allowNowPerforming: boolean;
  submitState: SubmitState;
  onChange: (patch: {
    templateId?: TemplateId;
    announcementMode?: Mode;
    allowNowPerforming?: boolean;
  }) => void;
  onBack: () => void;
  onSubmit: () => void;
}

const MODE_LABELS: Record<Mode, { title: string; copy: string }> = {
  live: {
    title: "Live",
    copy: "Take turns announcing your points, Eurovision-style. Great with a TV.",
  },
  instant: {
    title: "Instant",
    copy: "Reveal the winner in one shot. Great if you're short on time.",
  },
};

export default function VotingConfig({
  templateId,
  announcementMode,
  allowNowPerforming,
  submitState,
  onChange,
  onBack,
  onSubmit,
}: VotingConfigProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const templates = VOTING_TEMPLATES.filter((t) => t.id !== "custom");
  const submitting = submitState.kind === "submitting";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">Voting setup</h2>
        <p className="text-sm text-muted-foreground">
          Pick a template and how you want results revealed.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Template</p>
        <div className="grid grid-cols-1 gap-3">
          {templates.map((t) => {
            const selected = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange({ templateId: t.id as TemplateId })}
                className={`text-left rounded-lg border-2 px-4 py-3 transition-all ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-accent"
                }`}
              >
                <div className="space-y-1">
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.description}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {t.categories.map((c) => (
                      <li key={c.name} className="line-clamp-1">
                        <span className="font-medium text-foreground">
                          {c.name}
                        </span>
                        {c.hint ? <> &mdash; {c.hint}</> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Announcement</p>
        <div className="grid grid-cols-1 gap-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => {
            const selected = m === announcementMode;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ announcementMode: m })}
                className={`text-left rounded-lg border-2 px-4 py-3 transition-all ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-accent"
                }`}
              >
                <p className="font-semibold">{MODE_LABELS[m].title}</p>
                <p className="text-sm text-muted-foreground">
                  {MODE_LABELS[m].copy}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allowNowPerforming}
            onChange={(e) =>
              onChange({ allowNowPerforming: e.target.checked })
            }
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span className="space-y-1">
            <span className="text-sm font-medium flex items-center gap-2">
              Sync everyone to the performing act
              <button
                type="button"
                aria-label="About this toggle"
                onClick={(e) => {
                  e.preventDefault();
                  setInfoOpen((v) => !v);
                }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                i
              </button>
            </span>
            {infoOpen && (
              <span className="block text-xs text-muted-foreground">
                Lets you tap the currently-performing country to bring all
                guests to that card during voting. Off by default.
              </span>
            )}
          </span>
        </label>
      </div>

      {submitState.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {submitState.message}
        </p>
      )}

      <div className="flex justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "Creating…" : "Create room"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 4.3: Commit**

```bash
git add src/components/create/VotingConfig.tsx
git commit -m "Add VotingConfig component for /create Step 2"
```

---

## Task 5: `RoomReady` component

**Files:**
- Create: `src/components/create/RoomReady.tsx`

- [ ] **Step 5.1: Create the component**

Create `src/components/create/RoomReady.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Button from "@/components/ui/Button";
import type { Room } from "@/types";

interface RoomReadyProps {
  room: Room;
  onBack: () => void;
  onStartLobby: () => void;
}

function roomUrl(roomId: string): string {
  if (typeof window !== "undefined") {
    const configured = process.env.NEXT_PUBLIC_APP_URL;
    const base = configured ?? window.location.origin;
    return `${base}/room/${roomId}`;
  }
  return `/room/${roomId}`;
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export default function RoomReady({
  room,
  onBack,
  onStartLobby,
}: RoomReadyProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const url = roomUrl(room.id);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="space-y-8">
      <div className="space-y-1 text-center">
        <h2 className="text-xl font-bold tracking-tight">Room ready</h2>
        <p className="text-sm text-muted-foreground">
          Share the PIN, QR code, or link with your group.
        </p>
      </div>

      <section className="text-center space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Room PIN
        </p>
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl font-mono font-bold tracking-[0.5em]">
            {room.pin}
          </span>
          <CopyButton label="Copy" value={room.pin} />
        </div>
      </section>

      <section className="flex flex-col items-center gap-2">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            width={256}
            height={256}
            alt="Scan to join this room"
            className="rounded-lg"
          />
        ) : (
          <div className="h-[256px] w-[256px] rounded-lg bg-muted animate-shimmer" />
        )}
        <p className="text-xs text-muted-foreground">Scan to join</p>
      </section>

      <section className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Share link
        </p>
        <div className="flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2">
          <input
            type="text"
            readOnly
            value={url}
            className="flex-1 bg-transparent text-sm font-mono outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <CopyButton label="Copy" value={url} />
        </div>
      </section>

      <div className="space-y-3">
        <Button onClick={onStartLobby} className="w-full">
          Start lobby
        </Button>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Back to config
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 5.3: Commit**

```bash
git add src/components/create/RoomReady.tsx
git commit -m "Add RoomReady component for /create Step 3 (PIN + QR + copy)"
```

---

## Task 6: Wire `/create` page orchestrator

**Files:**
- Modify: `src/app/create/page.tsx`

- [ ] **Step 6.1: Replace the page stub**

Replace the full contents of `src/app/create/page.tsx` with:

```tsx
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
import RoomReady from "@/components/create/RoomReady";
import type { Room } from "@/types";

type Step = 1 | 2 | 3;
type Event = "semi1" | "semi2" | "final";
type TemplateId = "classic" | "spectacle" | "banger";
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

  // Step 3 state
  const [room, setRoom] = useState<Room | null>(null);

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
      setRoom(result.room);
      setSubmitState({ kind: "idle" });
      setStep(3);
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
            Step {step} of 3
          </p>
        </header>

        {step === 1 && (
          <EventSelection
            year={year}
            event={event}
            contestants={contestants}
            minYear={MIN_YEAR}
            maxYear={maxYear}
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

        {step === 3 && room && (
          <RoomReady
            room={room}
            onBack={() => setStep(2)}
            onStartLobby={() => router.push(`/room/${room.id}`)}
          />
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 6.2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 6.3: Run the full test suite**

Run: `npm run pre-push`
Expected: `tsc --noEmit` clean; vitest full suite passes (expected growth ≈ +18 over current baseline).

- [ ] **Step 6.4: Run the Vercel-equivalent build check**

Run: `npm run build`
Expected: `Compiled successfully` and exit 0. This catches ESLint `react/no-unescaped-entities` and other build-time checks the pre-push hook doesn't cover.

- [ ] **Step 6.5: Commit**

```bash
git add src/app/create/page.tsx
git commit -m "Wire /create page: session guard + 3-step wizard orchestrator"
```

---

## Task 7: Manual browser smoke + push + PR

**Files:**
- Modify: `TODO.md` (gitignored — local tick only)

Automated verification (Steps 6.3 + 6.4) has already run by this point. This task covers the manual browser smoke I can't execute myself and opens the PR.

- [ ] **Step 7.1: Tick the `/create` item in `TODO.md`**

Edit `TODO.md` — find the Phase 2 line `- [ ] /create — 3-step wizard (event selection, voting config, room ready with PIN + QR via qrcode package + share link)` and change `[ ]` to `[x]`. `TODO.md` is gitignored — no commit.

- [ ] **Step 7.2: Push the branch**

Run: `git push -u origin feat/create-wizard`
Expected: push succeeds (pre-push hook re-runs tsc + vitest).

- [ ] **Step 7.3: Open the PR**

Run:

```bash
gh pr create --base main \
  --title "Add /create 3-step room-creation wizard" \
  --body "$(cat <<'EOF'
## Summary
Last Phase 2 UI item. Replaces the `/create` stub with a functional 3-step wizard:

1. **Event** — year dropdown (2000 → current), event radio cards (Semi 1 / Semi 2 / Grand Final), 300 ms-debounced contestant preview via `GET /api/contestants`. Inline error + disabled Next if the cascade fails.
2. **Config** — 3 template cards (Classic / Spectacle / Banger — no Custom, deferred to Phase U A5-A8) with always-visible bullet previews of each category + hint; announcement-mode radio (Live / Instant); "Sync everyone to the performing act" toggle with info-icon expand.
3. **Ready** — large PIN + Copy PIN button; 256×256 QR code (client-side via `qrcode` pkg); shareable `{APP_URL}/room/{id}` input with Copy link button; primary "Start lobby" CTA → `/room/{id}` (room already in lobby status from creation).

Session guard on page load: no `emx_session` → `/onboard?next=/create`, same pattern as `/join` and `/room/[id]`. Closes the full host flow: landing → onboard → create → lobby → Start voting.

### Pure helpers (unit-tested)
- `src/lib/create/api.ts` — `fetchContestantsPreview` (GET /api/contestants wrapper; maps 404 → stable `CONTEST_DATA_NOT_FOUND` code) and `createRoomApi` (POST /api/rooms wrapper). DI-style with mocked `fetch`.
- `src/lib/create/errors.ts` — `mapCreateError(code)` table covering `INVALID_YEAR`, `INVALID_EVENT`, `INVALID_CATEGORIES`, `INVALID_CATEGORY`, `INVALID_ANNOUNCEMENT_MODE`, `INVALID_USER_ID`, `INVALID_BODY`, `INTERNAL_ERROR`, `NETWORK`.

### Components
- `EventSelection`, `VotingConfig`, `RoomReady` — pure presentational, parent owns state.

Follows the approved design + plan:
- [design](docs/superpowers/specs/2026-04-20-create-wizard-design.md)
- [plan](docs/superpowers/plans/2026-04-20-create-wizard.md)

Closes the `/create` item of Phase 2 in TODO.md. **Phase 2 complete after this PR.**

## Coverage
- `create/errors.ts`: 11 unit tests (table + fallbacks).
- `create/api.ts`: 7 unit tests (happy + 4xx + 500 + network, for both helpers).
- Page + components covered by the manual browser smoke matrix below.
- Full suite expected green, `tsc --noEmit` clean, `next build` clean.

## Test plan
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run build` (catches Vercel lint)
- [ ] **Manual browser smoke** — needs a human. Cases:
  1. Fresh admin (no session) → landing `Start a room` → redirected to `/onboard?next=/create` → onboards → returns to `/create` Step 1.
  2. Pick year 2025 + Grand Final → preview loads showing "N countries loaded · 🇳🇴 Norway · 🇷🇸 Serbia · 🇩🇰 Denmark, …" → Next enabled.
  3. Pick year 2026 + Grand Final → preview errors inline → Next disabled.
  4. Next to Step 2 → click each template card; selected ring moves; bullet previews render.
  5. Toggle announcement mode; toggle "Sync everyone"; open info icon.
  6. Click Create room → spinner → Step 3 with PIN, QR (256×256 image rendered), share link.
  7. Copy PIN → clipboard has PIN; label flips to "Copied!" for 2 s.
  8. Copy link → clipboard has `{origin}/room/{id}`; label flips same way.
  9. Click Start lobby → lands at `/room/{id}` with self as only member + ★ badge.
  10. Back from Step 3 → Step 2 with prior selections preserved; Back from Step 2 → Step 1 with prior year/event preserved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7.4: Report the PR URL**

Await manual smoke + merge.

---

## Out of scope

- Custom template + full category builder (§7.2) — Phase U A5–A8.
- Expand/collapse template-card animation (Phase U A1) — this PR renders always-visible bullets.
- Lobby-edit affordance for owner (Phase U A2).
- "Copied!" styled toast with fade animation (Phase U A12) — MVP does inline label swap.
- Year-data availability validation at the picker — wizard surfaces via preview inline error.
- Persisting wizard state across page refresh (sessionStorage).
- i18n of template names, descriptions, mode copy — Phase 1.5 T11–T12.
- Telemetry / analytics on wizard completion.
- RTL + jsdom for component tests — cross-cutting tooling decision.

---

## Self-review

**Spec coverage**
- Session guard + landing-page CTA handoff — Task 6 (useEffect redirect).
- Step 1 year dropdown + event radios + debounced preview + inline error — Task 3 component + Task 6 debounce effect.
- Step 2 three template cards (no Custom) with always-visible bullets — Task 4.
- Step 2 announcement-mode radio cards — Task 4.
- Step 2 "Sync everyone" toggle + info icon — Task 4.
- Step 2 Create-room submit + error map — Task 6 handleSubmit.
- Step 3 PIN + QR (256×256) + shareable link + Start lobby — Task 5.
- Step 3 Copy buttons with 2-s "Copied!" label swap — Task 5 CopyButton.
- Back navigation between steps — Task 6 setStep wiring.
- `CONTEST_DATA_NOT_FOUND` stable code mapping — Task 2 `fetchContestantsPreview`.

**Placeholder scan:** none. Every step has concrete code blocks or concrete commands with expected output.

**Type consistency:**
- `Event` = `"semi1" | "semi2" | "final"` — Task 3, Task 6 use identically.
- `TemplateId` = `"classic" | "spectacle" | "banger"` — Task 4, Task 6 match.
- `Mode` = `"live" | "instant"` — Task 4, Task 6 match.
- `ContestantsState` fields (`kind`, `count`, `preview`, `errorMessage`) — Task 3 prop shape, Task 6 state match.
- `SubmitState` discriminated union — Task 4 prop, Task 6 state match.
- `CreateRoomApiInput` — Task 2 signature, Task 6 call payload matches property-for-property.
- `fetchContestantsPreview` + `createRoomApi` — Task 2 exports consumed in Task 6.
- `CopyButton` internal to `RoomReady.tsx` (Task 5) — no cross-task reference.

**Scope:** one page, two small libs, three components. Single-plan territory, comparable to the `/join` PR in size.
