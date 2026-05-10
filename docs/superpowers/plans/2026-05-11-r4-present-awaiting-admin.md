# R4 #3 `/present` "Awaiting an admin to continue…" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TV (`/room/[id]/present`) renders "Awaiting an admin to continue…" copy when the room is cascade-exhausted, shows a "Host is finishing the show" chip during batch-reveal, and surfaces `<SkipBannerQueue>` for `announce_skip` events. Closes the R4 cluster (R4 #1 + R4 #2 already merged).

**Architecture:** UI-only slice on existing infrastructure. `PresentPage` already polls `/api/results` every 2 s AND subscribes to `useRoomRealtime`; this plan extends the broadcast callback with `announce_skip` + `batch_reveal_started` handlers and threads `batchRevealMode` through to `<PresentScreen>`. No new files (locale keys aside), no schema, no endpoints, no orchestrator changes.

**Tech Stack:** Next.js 14 App Router, React 18, Vitest + RTL with jsdom (per-file `// @vitest-environment jsdom`), `next-intl` for locale strings.

**Spec:** [docs/superpowers/specs/2026-05-11-r4-present-awaiting-admin-design.md](../specs/2026-05-11-r4-present-awaiting-admin-design.md)

**Branch:** `feat/r4-present-awaiting-admin` — currently 1 commit ahead of main (spec doc, `b3e3e01`). Based on main with R4 #1 (PR #95) and R4 #2 (PR #96) merged.

**Existing helpers reused:**
- `<SkipBannerQueue>` at [src/components/room/SkipBannerQueue.tsx](../../../src/components/room/SkipBannerQueue.tsx) (exports `SkipEvent` type).
- `useRoomRealtime` hook (already mounted on `PresentPage`).
- `mapRoom` in `src/lib/rooms/shared.ts` (already maps `batch_reveal_mode` → `batchRevealMode` from R4 #2).

---

## Task 1: Locale keys

**Files:**
- Modify: `src/locales/en.json` (add `present.cascadeExhausted.*` + `present.batchReveal.chip`)
- Modify: `src/locales/{es,uk,fr,de}.json` ONLY if `locales.test.ts` enforces empty stubs

- [ ] **Step 1: Read `src/locales/locales.test.ts` to confirm whether non-en stubs are required**

```bash
cat /Users/valeriiakulynych/Projects/eurovisionmaxxing/src/locales/locales.test.ts
```

Expected: it either checks key parity across all locale files (need stubs) OR only validates `en.json` shape (skip stubs).

- [ ] **Step 2: Add the new keys to `src/locales/en.json`**

Find the existing `present` namespace (look for `"present": {` — already contains `lobby`, `voting`, `votingEnding`, `scoring`, `announcing`, `done`). Add two sibling sub-namespaces inside it:

```json
"present": {
  "...existing keys...",
  "cascadeExhausted": {
    "title": "Awaiting an admin to continue…",
    "subtitle": "All announcers are away. The host will resume when they're back."
  },
  "batchReveal": {
    "chip": "Host is finishing the show"
  }
}
```

Preserve all existing keys. Match indentation.

- [ ] **Step 3: Add empty stubs to non-en locale files (only if Step 1 confirmed it's required)**

If required, add to each of `src/locales/es.json`, `src/locales/uk.json`, `src/locales/fr.json`, `src/locales/de.json`:

```json
"present": {
  "...existing stubs...",
  "cascadeExhausted": { "title": "", "subtitle": "" },
  "batchReveal": { "chip": "" }
}
```

If `locales.test.ts` allows non-en files to be empty `{}` or sparse, skip this step entirely.

- [ ] **Step 4: Run the locales test**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/locales 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locales/en.json
# Add other locale files only if you modified them in step 3:
# git add src/locales/es.json src/locales/uk.json src/locales/fr.json src/locales/de.json

git commit -m "$(cat <<'EOF'
feat(locale): present.cascadeExhausted + present.batchReveal keys (R4 #3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PresentScreen cascade-exhaust render branch + SkipBannerQueue mount (TDD)

**Files:**
- Modify: `src/components/present/PresentScreen.tsx`
- Modify: `src/components/present/PresentScreen.test.tsx`

- [ ] **Step 1: Add failing RTL tests**

Open `src/components/present/PresentScreen.test.tsx`. At the bottom of the file (after the existing `describe` blocks), add a new `describe`:

```ts
import type { SkipEvent } from "@/components/room/SkipBannerQueue";

describe("PresentScreen — cascade-exhausted (R4 #3)", () => {
  it("renders 'Awaiting an admin' title when status=announcing, no announcerDisplayName, batchRevealMode=false", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={[]}
        batchRevealMode={false}
      />,
    );
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-cascade-exhausted",
      "true",
    );
    expect(
      screen.getByText("present.cascadeExhausted.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("present.cascadeExhausted.subtitle"),
    ).toBeInTheDocument();
  });

  it("suppresses leaderboard rows in cascade-exhaust state", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 12, rank: 1 },
        ]}
        batchRevealMode={false}
      />,
    );
    // Leaderboard row should NOT render in cascade-exhaust.
    expect(screen.queryByTestId("present-row-2026-se")).toBeNull();
  });

  it("renders SkipBannerQueue when skipEvents is non-empty", () => {
    const skipEvents: SkipEvent[] = [
      { id: "u1-100", userId: "u1", displayName: "Alice", at: 100 },
    ];
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        batchRevealMode={false}
        skipEvents={skipEvents}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does not render SkipBannerQueue when skipEvents is empty", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        batchRevealMode={false}
        skipEvents={[]}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/present/PresentScreen.test.tsx 2>&1 | tail -20
```

Expected: 4 FAIL — `data-cascade-exhausted` attr missing, `present.cascadeExhausted.title` text missing, `present.cascadeExhausted.subtitle` missing, leaderboard rows still render, no banner when events provided.

- [ ] **Step 3: Add the new props to PresentScreen + import SkipBannerQueue + SkipEvent type**

In `src/components/present/PresentScreen.tsx`, at the top of the file (alongside the existing imports):

```ts
import SkipBannerQueue, { type SkipEvent } from "@/components/room/SkipBannerQueue";
```

Update the `PresentScreenProps` interface to add the two optional props:

```ts
interface PresentScreenProps {
  // ... existing props ...
  /**
   * SPEC §10.2.1 — true when the room is in batch-reveal mode (admin
   * driving reveals on behalf of absent users). Toggles the
   * "Host is finishing the show" chip in the announcer header.
   */
  batchRevealMode?: boolean;
  /**
   * SPEC §10.2.1 — accumulated announce_skip broadcast events. Mounted
   * via <SkipBannerQueue> overlay. Parent owns the array; component
   * advances internally.
   */
  skipEvents?: SkipEvent[];
}
```

- [ ] **Step 4: Add the cascade-exhaust render branch**

In `PresentScreen.tsx`, find where the component currently dispatches by status (the chain of `if (status === "lobby") { ... }`, `if (status === "voting" || ...) { ... }`, etc.). The branch order matters — cascade-exhaust must be checked BEFORE the announcing-leaderboard branch.

After the destructured props but before `if (status === "lobby")`, add:

```ts
const isCascadeExhausted =
  status === "announcing" &&
  !announcerDisplayName &&
  !batchRevealMode;
```

Then ABOVE the existing `if (status === "lobby")` line (so it runs first), add:

```tsx
if (isCascadeExhausted) {
  return (
    <main
      data-testid="present-screen"
      data-status="announcing"
      data-cascade-exhausted="true"
      className="flex min-h-screen flex-col items-center justify-center px-12 py-12 text-center"
    >
      <p className="text-2xl text-muted-foreground">
        {t("present.cascadeExhausted.subtitle")}
      </p>
      <p className="mt-6 text-7xl font-bold">
        {t("present.cascadeExhausted.title")}
      </p>
      {skipEvents && skipEvents.length > 0 ? (
        <SkipBannerQueue events={skipEvents} />
      ) : null}
    </main>
  );
}
```

- [ ] **Step 5: Mount `<SkipBannerQueue>` on the existing announcing-leaderboard branch**

The existing `announcing | done` branch returns `<PresentLeaderboard ... />`. Wrap or extend it to also render the queue when events exist. Simplest pass: add a fragment around the return so the queue renders alongside:

Find the existing return at the bottom of the main `PresentScreen` function:

```tsx
return (
  <PresentLeaderboard
    status={status}
    rows={rows}
    contestantById={contestantById}
    announcerDisplayName={announcerDisplayName}
    titleAnnouncing={t("present.announcing.title")}
    titleDone={t("present.done.title")}
    announcerLabel={...}
    positionLabel={...}
    pendingReveal={...}
  />
);
```

Wrap it:

```tsx
return (
  <>
    <PresentLeaderboard
      status={status}
      rows={rows}
      contestantById={contestantById}
      announcerDisplayName={announcerDisplayName}
      titleAnnouncing={t("present.announcing.title")}
      titleDone={t("present.done.title")}
      announcerLabel={announcerDisplayName ? t("present.announcing.announcer", { name: announcerDisplayName }) : ""}
      positionLabel={showPosition ? t("present.announcing.position", { position: announcerPosition, total: announcerCount }) : ""}
      pendingReveal={...preserve existing...}
    />
    {skipEvents && skipEvents.length > 0 ? (
      <SkipBannerQueue events={skipEvents} />
    ) : null}
  </>
);
```

(Preserve the existing `announcerLabel`, `positionLabel`, `pendingReveal` literal expressions exactly. The diff is just the fragment wrapper + the queue render.)

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/present/PresentScreen.test.tsx 2>&1 | tail -20
```

Expected: ALL PASS — 4 new tests + every existing test (regression).

- [ ] **Step 7: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/present/PresentScreen.tsx src/components/present/PresentScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(present): cascade-exhaust waiting copy + SkipBannerQueue overlay (R4 #3)

When the room is in cascade-exhaust state (status='announcing' AND
no announcer AND batch_reveal_mode=false), the TV shows
"Awaiting an admin to continue…" centered. SkipBannerQueue is mounted
in both the cascade-exhaust branch and the announcing-leaderboard
branch so cascaded skip events render on the TV regardless of the
specific announce sub-state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PresentScreen batch-reveal chip + RTL (TDD)

**Files:**
- Modify: `src/components/present/PresentScreen.tsx` (chip in `<PresentLeaderboard>` header)
- Modify: `src/components/present/PresentScreen.test.tsx` (2 cases)

- [ ] **Step 1: Add failing RTL tests**

In `src/components/present/PresentScreen.test.tsx`, add a new describe block (after the cascade-exhausted block from Task 2):

```ts
describe("PresentScreen — batch-reveal active (R4 #3)", () => {
  it("renders 'Host is finishing the show' chip when batchRevealMode=true and announcer is set", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 12, rank: 1 },
        ]}
        announcerDisplayName="Alice"
        batchRevealMode={true}
      />,
    );
    expect(screen.getByTestId("present-batch-reveal-chip")).toHaveTextContent(
      "present.batchReveal.chip",
    );
    // Leaderboard still renders.
    expect(screen.getByTestId("present-row-2026-se")).toBeInTheDocument();
    // Announcer label still renders.
    expect(
      screen.getByText(/present\.announcing\.announcer/),
    ).toBeInTheDocument();
  });

  it("does NOT render the chip when batchRevealMode=false (regression)", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 12, rank: 1 },
        ]}
        announcerDisplayName="Alice"
        batchRevealMode={false}
      />,
    );
    expect(
      screen.queryByTestId("present-batch-reveal-chip"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/present/PresentScreen.test.tsx 2>&1 | tail -10
```

Expected: 1 new test FAIL (chip test). The "does NOT render" test may PASS by accident — that's fine, the chip will only appear once we implement.

- [ ] **Step 3: Plumb `batchRevealMode` through to `<PresentLeaderboard>`**

In `src/components/present/PresentScreen.tsx`, find the `PresentLeaderboardProps` interface and add the new optional prop:

```ts
interface PresentLeaderboardProps {
  // ... existing props ...
  /** R4 #3 — when true, render "Host is finishing the show" chip below announcer label. */
  isBatchReveal?: boolean;
}
```

Pass it from the parent component's return (the `return ( <> <PresentLeaderboard ... /> ... </> )` from Task 2):

```tsx
<PresentLeaderboard
  status={status}
  rows={rows}
  contestantById={contestantById}
  announcerDisplayName={announcerDisplayName}
  titleAnnouncing={t("present.announcing.title")}
  titleDone={t("present.done.title")}
  announcerLabel={...preserve existing...}
  positionLabel={...preserve existing...}
  pendingReveal={...preserve existing...}
  isBatchReveal={batchRevealMode === true}
/>
```

- [ ] **Step 4: Render the chip in the announcer header**

In `PresentLeaderboard`, find the existing announcer header rendering (where `announcerDisplayName && status === "announcing"` renders the announcerLabel):

```tsx
{announcerDisplayName && status === "announcing" ? (
  <p className="text-2xl text-muted-foreground">{announcerLabel}</p>
) : null}
```

Replace it with a wrapper that also renders the chip when `isBatchReveal`:

```tsx
{announcerDisplayName && status === "announcing" ? (
  <>
    <p className="text-2xl text-muted-foreground">{announcerLabel}</p>
    {isBatchReveal ? (
      <p
        data-testid="present-batch-reveal-chip"
        className="text-base text-accent"
        aria-live="polite"
      >
        {t("present.batchReveal.chip")}
      </p>
    ) : null}
  </>
) : null}
```

The `useTranslations` hook is already imported in this file. Make sure `t` is available in `PresentLeaderboard` — if it's not, add `const t = useTranslations();` at the top of the function. (Quick sanity check: search the file for existing `useTranslations` usage in `PresentLeaderboard`. If `titleAnnouncing` etc. are passed as already-resolved strings, you may need a fresh `useTranslations` call inside `PresentLeaderboard` for the chip key.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/present/PresentScreen.test.tsx 2>&1 | tail -15
```

Expected: ALL PASS — both new tests + every existing test.

- [ ] **Step 6: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/present/PresentScreen.tsx src/components/present/PresentScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(present): "Host is finishing the show" chip in TV announcer header (R4 #3)

When room.batch_reveal_mode=true, the TV's announcer header gains a
muted accent chip below the announcer's name reading "Host is
finishing the show". Mirror of the same chip on <AnnouncingView> from
R4 #2 — guests reading the TV know whether the announcer is live or
being driven by the admin.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: PresentPage broadcast handlers + thread batchRevealMode

**Files:**
- Modify: `src/app/room/[id]/present/page.tsx`

No test changes — `PresentPage` is the integration glue. The behavior is exercised end-to-end by `PresentScreen` RTL plus the existing Playwright cascade test (which doesn't open `/present` but does drive the underlying state transitions).

- [ ] **Step 1: Add `batchRevealMode` to `RoomShape`**

Find the local `RoomShape` interface near the top of `src/app/room/[id]/present/page.tsx`. Add:

```ts
interface RoomShape {
  id: string;
  pin: string;
  status: string;
  ownerUserId: string;
  announcementMode?: string;
  announcingUserId?: string | null;
  batchRevealMode: boolean;
}
```

The `fetchRoomData` already returns the full `Room` domain type — `batchRevealMode` was added to `mapRoom` in R4 #2 Task 1. The `RoomShape` interface here is a structural subset; add the new field.

- [ ] **Step 2: Import `SkipEvent` type and add `skipEvents` state**

At the top of the file (alongside existing imports):

```ts
import type { SkipEvent } from "@/components/room/SkipBannerQueue";
```

Inside the component body, near the existing `useState` calls:

```ts
const [skipEvents, setSkipEvents] = useState<SkipEvent[]>([]);
```

- [ ] **Step 3: Extend the `useRoomRealtime` callback**

Find the existing `useRoomRealtime` invocation:

```ts
useRoomRealtime(roomId, (event) => {
  if (event.type === "status_changed" || event.type === "voting_ending") {
    void load();
  }
});
```

Replace with:

```ts
useRoomRealtime(roomId, (event) => {
  if (event.type === "status_changed" || event.type === "voting_ending") {
    void load();
  } else if (event.type === "batch_reveal_started") {
    void load();
  } else if (event.type === "announce_skip") {
    setSkipEvents((prev) => [
      ...prev,
      {
        id: `${event.userId}-${Date.now()}`,
        userId: event.userId,
        displayName: event.displayName,
        at: Date.now(),
      },
    ]);
  }
});
```

- [ ] **Step 4: Pass new props to `<PresentScreen>`**

Find the existing `<PresentScreen>` JSX render:

```tsx
<PresentScreen
  status={phase.room.status as PresentStatus}
  pin={phase.room.pin}
  contestants={phase.contestants}
  leaderboard={results?.leaderboard}
  announcerDisplayName={announcerDisplayName}
  roomMemberTotal={phase.memberships.length}
  pendingReveal={...}
  announcerPosition={...}
  announcerCount={...}
/>
```

Add the new props at the end:

```tsx
<PresentScreen
  status={phase.room.status as PresentStatus}
  pin={phase.room.pin}
  contestants={phase.contestants}
  leaderboard={results?.leaderboard}
  announcerDisplayName={announcerDisplayName}
  roomMemberTotal={phase.memberships.length}
  pendingReveal={...preserve existing...}
  announcerPosition={results?.announcement?.announcerPosition}
  announcerCount={results?.announcement?.announcerCount}
  batchRevealMode={phase.room.batchRevealMode}
  skipEvents={skipEvents}
/>
```

- [ ] **Step 5: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 6: Run all tests for regression**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/present 2>&1 | tail -10
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test 2>&1 | tail -5
```

Expected: ALL PASS.

- [ ] **Step 7: Optional smoke test in dev**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run dev &
sleep 5
# Seed a cascade-exhausted room (uses the seed state from R4 #2):
npm run seed:room -- --state=announcing-cascade-all-absent --json
# Open /room/{seed-roomId}/present in a browser — should see "Awaiting an admin to continue…"
```

Skip if env isn't configured. Note "skipped" in the report.

- [ ] **Step 8: Commit**

```bash
git add src/app/room/[id]/present/page.tsx
git commit -m "$(cat <<'EOF'
feat(present): wire batchRevealMode + announce_skip + batch_reveal_started (R4 #3)

PresentPage's RoomShape gains batchRevealMode (mapped from rooms.batch_reveal_mode).
The useRoomRealtime callback now also handles batch_reveal_started
(triggers load) and announce_skip (pushes to skipEvents queue, fed to
<SkipBannerQueue> overlay on the TV).

Closes the R4 cluster.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Final cleanup — TODO tick + verifications + push approval gate

**Files:**
- Modify: `TODO.md` (tick line 269 — gitignored, local only)

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test 2>&1 | tail -5
```

Expected: ALL PASS.

- [ ] **Step 2: Type-check + lint**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3 && npm run lint 2>&1 | tail -5
```

Expected: type-check green, lint shows only pre-existing warnings (not from this branch).

- [ ] **Step 3: Tick TODO.md line 269**

Find the line in `TODO.md`:

```markdown
  - [ ] /present copy "Awaiting an admin to continue…" when both admin and co-admins absent
```

(Or close to that — search for the §10.2.1 cluster around line 269.)

Change to:

```markdown
  - [x] /present copy "Awaiting an admin to continue…" when both admin and co-admins absent  _(landed on `feat/r4-present-awaiting-admin` — TV cascade-exhaust copy + "Host is finishing the show" chip during batch-reveal + <SkipBannerQueue> overlay subscribed via PresentPage's existing useRoomRealtime hook (now also handles batch_reveal_started + announce_skip). UI-only slice; no schema, no endpoints, no orchestrator changes. Closes the R4 cluster (R4 #1 + R4 #2 already merged). Spec: `docs/superpowers/specs/2026-05-11-r4-present-awaiting-admin-design.md`. Plan: `docs/superpowers/plans/2026-05-11-r4-present-awaiting-admin.md`.)_
```

(TODO.md is gitignored — local-only, no commit.)

- [ ] **Step 4: Pause for user push approval**

Push and PR are shared-state mutations. Stop here, summarise commits, and wait for explicit user approval before:

```bash
git push -u origin feat/r4-present-awaiting-admin
gh pr create --title "feat(present): R4 #3 /present 'Awaiting an admin to continue…' (§10.2.1, §10.3)" --body ...
```

PR body template (use when user approves):

```
## Summary

- TV (`/room/[id]/present`) now renders "Awaiting an admin to continue…" copy when the room is cascade-exhausted (R4 #1 sentinel state).
- TV announcer header gains a "Host is finishing the show" chip when `batch_reveal_mode=true` (R4 #2 mode).
- `<SkipBannerQueue>` overlay subscribed to the TV — `announce_skip` broadcasts surface as banners on the TV, not just guest phones.
- Two new broadcast handlers in `PresentPage`'s existing `useRoomRealtime` callback: `batch_reveal_started` (triggers refetch), `announce_skip` (pushes to skipEvents queue).

UI-only slice. No schema, no endpoints, no orchestrator changes. Closes the R4 cluster.

## Test plan

- [ ] Apply the R4 #1 + R4 #2 schema migrations if not already applied (this PR doesn't add new migrations).
- [ ] Seed: `npm run seed:room -- --state=announcing-cascade-all-absent` (the seed state from R4 #2).
- [ ] Open `/room/{seed-roomId}/present` in a browser → "Awaiting an admin to continue…" copy renders.
- [ ] In a separate browser tab, sign in as owner and tap "Finish the show" on `/room/{seed-roomId}` → present screen swings to leaderboard + "Host is finishing the show" chip.
- [ ] Run `npm test`, `npm run type-check`, `npm run lint`, `npm run test:e2e`.
```

---

## Parallelization map

Strict order: 1 → 2 → 3 → 4 → 5.

- Task 1 (locale keys) is a chokepoint — Tasks 2 + 3 reference the keys.
- Task 2 (cascade-exhaust + SkipBannerQueue mount) precedes Task 3 (chip) because Task 3's RTL test relies on the modified component shape.
- Task 4 (PresentPage glue) depends on Task 2 + Task 3 (uses the new PresentScreen props).
- Task 5 is final cleanup.

No parallelization opportunities — the slice is short enough that serial execution adds minimal cost vs the coordination overhead of parallel.

## Self-review checklist (run before declaring complete)

- [ ] `present.cascadeExhausted.{title,subtitle}` and `present.batchReveal.chip` keys exist in `src/locales/en.json`.
- [ ] `<PresentScreen>` accepts `batchRevealMode?: boolean` and `skipEvents?: SkipEvent[]` props.
- [ ] `<PresentScreen>` cascade-exhaust branch renders BEFORE the lobby/voting/scoring/announcing branches (status-checking order matters).
- [ ] `<PresentLeaderboard>` renders the chip ONLY when `isBatchReveal === true` AND announcer is set.
- [ ] `<SkipBannerQueue>` renders in BOTH the cascade-exhaust branch AND the announcing-leaderboard branch — events from before exhaust still play out, events that arrive in batch-reveal still surface.
- [ ] `PresentPage`'s `useRoomRealtime` callback handles `batch_reveal_started` (triggers `load()`) and `announce_skip` (pushes to `skipEvents`).
- [ ] `RoomShape` in `PresentPage` includes `batchRevealMode: boolean`.
- [ ] `npm test`, `npm run type-check`, `npm run lint` all green.
- [ ] TODO.md line 269 ticked with branch + spec + plan refs.
