# R4 #4 "Re-shuffle order" UI Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner-only "Re-shuffle order" button in `<AnnouncerRoster>` header that calls the existing `patchAnnouncementOrder` endpoint, plus the missing `announcement_order_reshuffled` broadcast subscriber in `<AnnouncingView>`.

**Architecture:** UI-only slice. Mirrors the canonical owner-callback pattern from `<AnnouncerRoster>`'s `onRestore` (optional callback prop, button only renders when prop provided). The `canReshuffle` gate is derived in `<AnnouncingView>` from announcement state (`currentAnnounceIdx === 0 && announcerPosition === 1 && skippedUserIds.length === 0 && !batchRevealMode`). Server enforces the same gate via `results.announced` count and returns `ANNOUNCE_IN_PROGRESS` 409 on race.

**Tech Stack:** Next.js 14 App Router, React 18, Vitest + RTL with jsdom (per-file `// @vitest-environment jsdom`), `next-intl` for locale strings.

**Spec:** [docs/superpowers/specs/2026-05-11-r4-reshuffle-ui-button-design.md](../specs/2026-05-11-r4-reshuffle-ui-button-design.md)

**Branch:** `feat/r4-reshuffle-ui-button` — currently 1 commit ahead of main (spec doc, `a5031d7`). Based on main with R4 #1 (PR #95) and R4 #2 (PR #96) merged. R4 #3 (PR #97) is open but doesn't conflict with this slice (different files).

**Existing helpers reused:**
- `<AnnouncerRoster>` at [src/components/room/AnnouncerRoster.tsx](../../../src/components/room/AnnouncerRoster.tsx) — already has `onRestore` + `restoringUserId` callback pattern; new props mirror that shape.
- `patchAnnouncementOrder` at [src/lib/room/api.ts:227](../../../src/lib/room/api.ts#L227) — returns `ApiOk<{announcementOrder, announcingUserId}> | ApiFail`.
- `useRoomRealtime` early-return-per-event pattern in `<AnnouncingView>` `onMessage` callback.
- Existing `restoreError` display pattern (`role="alert"`, accent text-destructive, testid) at AnnouncingView:670.

---

## Task 1: Locale keys

**Files:**
- Modify: `src/locales/en.json` (new `roster.reshuffle.*` namespace)
- Modify: `src/locales/{es,uk,fr,de}.json` ONLY if `locales.test.ts` enforces non-en stubs

- [ ] **Step 1: Read locales test to confirm stub policy**

```bash
cat /Users/valeriiakulynych/Projects/eurovisionmaxxing/src/locales/locales.test.ts
```

Note whether non-en files require key parity (need stubs) or can be sparse. The R4 #1 + R4 #3 work added stubs in all locale files — check whether that's still the convention or whether the R4 #3 commit set a different precedent.

- [ ] **Step 2: Add `roster.reshuffle.*` to `src/locales/en.json`**

If a top-level `"roster"` namespace already exists (from prior work), extend it. If not, add a new namespace at the top level:

```json
"roster": {
  "reshuffle": {
    "idleCta": "🎲 Re-shuffle order",
    "busyCta": "Re-shuffling…",
    "errorInProgress": "Reveals have started — re-shuffle is no longer available.",
    "errorGeneric": "Couldn't re-shuffle. Try again?"
  }
}
```

Place it alphabetically (between existing top-level keys) for consistency with the existing file shape.

- [ ] **Step 3: Add empty stubs to non-en locale files (only if Step 1 confirmed parity is enforced)**

If required, add to each of `src/locales/{es,uk,fr,de}.json`:

```json
"roster": {
  "reshuffle": {
    "idleCta": "",
    "busyCta": "",
    "errorInProgress": "",
    "errorGeneric": ""
  }
}
```

If non-en files can be sparse, skip this step entirely.

- [ ] **Step 4: Run the locales test**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/locales 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locales/en.json
# Stage other locale files only if Step 3 modified them.
git commit -m "$(cat <<'EOF'
feat(locale): roster.reshuffle.* keys (R4 #4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: AnnouncerRoster Re-shuffle button (TDD)

**Files:**
- Modify: `src/components/room/AnnouncerRoster.tsx`
- Modify: `src/components/room/AnnouncerRoster.test.tsx`

- [ ] **Step 1: Add 5 failing RTL tests**

Open `src/components/room/AnnouncerRoster.test.tsx`. Add a new `describe` block at the bottom (after existing blocks):

```ts
describe("AnnouncerRoster — re-shuffle button (R4 #4)", () => {
  const baseMembers: RosterMember[] = [
    { userId: "u1", displayName: "Alice", avatarSeed: "a" },
    { userId: "u2", displayName: "Bob", avatarSeed: "b" },
  ];
  const presenceUserIds = new Set(["u1", "u2"]);

  it("renders the button when onReshuffle is provided AND canReshuffle is true", () => {
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        onReshuffle={() => {}}
        canReshuffle={true}
      />,
    );
    expect(screen.getByTestId("roster-reshuffle")).toBeInTheDocument();
  });

  it("hides the button when canReshuffle is false (regression: hide-not-grey UX)", () => {
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        onReshuffle={() => {}}
        canReshuffle={false}
      />,
    );
    expect(screen.queryByTestId("roster-reshuffle")).toBeNull();
  });

  it("hides the button when onReshuffle is undefined (non-owner view)", () => {
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        canReshuffle={true}
      />,
    );
    expect(screen.queryByTestId("roster-reshuffle")).toBeNull();
  });

  it("shows busy copy when reshuffling is true", () => {
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        onReshuffle={() => {}}
        canReshuffle={true}
        reshuffling={true}
      />,
    );
    expect(screen.getByTestId("roster-reshuffle")).toHaveTextContent(
      "roster.reshuffle.busyCta",
    );
  });

  it("calls onReshuffle when tapped", async () => {
    const onReshuffle = vi.fn();
    const user = userEvent.setup();
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        onReshuffle={onReshuffle}
        canReshuffle={true}
      />,
    );
    await user.click(screen.getByTestId("roster-reshuffle"));
    expect(onReshuffle).toHaveBeenCalledTimes(1);
  });
});
```

If `userEvent` and `vi` aren't already imported in this file, add the imports per the existing test file's convention.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/AnnouncerRoster.test.tsx 2>&1 | tail -15
```

Expected: 5 FAIL — new props don't exist; button not rendered.

- [ ] **Step 3: Add the 3 new optional props to `AnnouncerRosterProps`**

In `src/components/room/AnnouncerRoster.tsx`, find the `AnnouncerRosterProps` interface. Add at the end:

```ts
/**
 * SPEC §10.2.1 — owner-only callback for re-shuffling the announcement
 * order. When provided, the header renders a "Re-shuffle order" button
 * — but only when canReshuffle is also true. Omit on non-owner views.
 */
onReshuffle?: () => void;
/**
 * True while the reshuffle API call is in flight. Disables the button
 * + flips its copy to "Re-shuffling…".
 */
reshuffling?: boolean;
/**
 * SPEC §10.2.1 — true only before any user has revealed any point.
 * When false, the button is hidden entirely (not greyed out — narrow
 * window means a locked button is dead UI).
 */
canReshuffle?: boolean;
```

Destructure them in the function signature alongside existing `onRestore`, `restoringUserId`:

```ts
export default function AnnouncerRoster({
  members,
  presenceUserIds,
  currentAnnouncerId,
  delegateUserId,
  skippedUserIds,
  onRestore,
  restoringUserId,
  onReshuffle,
  reshuffling,
  canReshuffle,
}: AnnouncerRosterProps) {
```

- [ ] **Step 4: Add `useTranslations` import + usage**

At the top of the file, add the import (alongside existing imports):

```ts
import { useTranslations } from "next-intl";
```

Inside the function body (near the top, before the early-return for empty members):

```ts
const t = useTranslations();
```

- [ ] **Step 5: Render the button in the existing `<header>` element**

Find the existing `<header>` element (currently containing the `<h2>Roster</h2>` + `<p>here now</p>`). Wrap the right-side content in a flex container so the new button sits next to the legend:

```tsx
<header className="flex items-baseline justify-between gap-2">
  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
    Roster
  </h2>
  <div className="flex items-baseline gap-3">
    <p className="text-[10px] text-muted-foreground">
      <span
        aria-hidden
        className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1 align-middle"
      />
      here now
    </p>
    {onReshuffle && canReshuffle ? (
      <button
        type="button"
        onClick={onReshuffle}
        disabled={reshuffling}
        data-testid="roster-reshuffle"
        aria-label="Re-shuffle the announcement order"
        className="rounded border border-accent/50 bg-accent/5 px-2 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10 active:scale-[0.98] disabled:opacity-60"
      >
        {reshuffling
          ? t("roster.reshuffle.busyCta")
          : t("roster.reshuffle.idleCta")}
      </button>
    ) : null}
  </div>
</header>
```

The button's visual style mirrors the `Restore` button on skipped rows — same accent-color CSS classes establish a consistent "owner action" visual category.

- [ ] **Step 6: Run tests to verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/AnnouncerRoster.test.tsx 2>&1 | tail -15
```

Expected: ALL PASS — 5 new + every existing test.

- [ ] **Step 7: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/room/AnnouncerRoster.tsx src/components/room/AnnouncerRoster.test.tsx
git commit -m "$(cat <<'EOF'
feat(room): re-shuffle order button in AnnouncerRoster header (R4 #4)

Owner-only button renders only when both onReshuffle is provided AND
canReshuffle is true — hidden entirely outside the narrow
pre-first-reveal window. Mirrors the existing onRestore + restoringUserId
optional-callback pattern. Visual style matches the Restore button on
skipped rows for consistent "owner action" affordance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: AnnouncingView wiring (canReshuffle + handler + props) (TDD)

**Files:**
- Modify: `src/components/room/AnnouncingView.tsx`
- Modify: `src/components/room/AnnouncingView.test.tsx`

- [ ] **Step 1: Add 3 failing RTL tests**

In `src/components/room/AnnouncingView.test.tsx`, find an appropriate place (likely at the bottom or after the existing owner-roster test block). Add:

```ts
describe("AnnouncingView — re-shuffle order button (R4 #4)", () => {
  it("owner sees the re-shuffle button when announcement state is fresh (no advance yet)", () => {
    render(
      <AnnouncingView
        room={makeRoomShape()}
        contestants={[]}
        currentUserId={OWNER_ID}
        members={[
          { userId: OWNER_ID, displayName: "Admin", avatarSeed: "x" },
          { userId: U1, displayName: "Alice", avatarSeed: "a" },
        ]}
        announcement={{
          announcingUserId: U1,
          announcingDisplayName: "Alice",
          announcingAvatarSeed: "a",
          currentAnnounceIdx: 0,
          pendingReveal: { contestantId: "c1", points: 1 },
          queueLength: 10,
          delegateUserId: null,
          announcerPosition: 1,
          announcerCount: 3,
          skippedUserIds: [],
        }}
      />,
    );
    expect(screen.getByTestId("roster-reshuffle")).toBeInTheDocument();
  });

  it("owner does NOT see the button after first reveal (currentAnnounceIdx > 0)", () => {
    render(
      <AnnouncingView
        room={makeRoomShape()}
        contestants={[]}
        currentUserId={OWNER_ID}
        members={[
          { userId: OWNER_ID, displayName: "Admin", avatarSeed: "x" },
          { userId: U1, displayName: "Alice", avatarSeed: "a" },
        ]}
        announcement={{
          announcingUserId: U1,
          announcingDisplayName: "Alice",
          announcingAvatarSeed: "a",
          currentAnnounceIdx: 1,
          pendingReveal: { contestantId: "c2", points: 2 },
          queueLength: 10,
          delegateUserId: null,
          announcerPosition: 1,
          announcerCount: 3,
          skippedUserIds: [],
        }}
      />,
    );
    expect(screen.queryByTestId("roster-reshuffle")).toBeNull();
  });

  it("owner does NOT see the button after rotation (announcerPosition > 1)", () => {
    render(
      <AnnouncingView
        room={makeRoomShape()}
        contestants={[]}
        currentUserId={OWNER_ID}
        members={[
          { userId: OWNER_ID, displayName: "Admin", avatarSeed: "x" },
          { userId: U1, displayName: "Alice", avatarSeed: "a" },
        ]}
        announcement={{
          announcingUserId: U1,
          announcingDisplayName: "Alice",
          announcingAvatarSeed: "a",
          currentAnnounceIdx: 0,
          pendingReveal: { contestantId: "c1", points: 1 },
          queueLength: 10,
          delegateUserId: null,
          announcerPosition: 2,
          announcerCount: 3,
          skippedUserIds: [],
        }}
      />,
    );
    expect(screen.queryByTestId("roster-reshuffle")).toBeNull();
  });
});
```

Adapt `makeRoomShape()`, `OWNER_ID`, `U1` to whatever the existing `AnnouncingView.test.tsx` uses for its fixtures. Read the file first to mirror the exact prop shape — the `<AnnouncingView>` interface is large, and existing tests will have a helper or constant set you should reuse.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/AnnouncingView.test.tsx 2>&1 | tail -15
```

Expected: 3 FAIL — button not rendered yet.

- [ ] **Step 3: Add `canReshuffle` derivation + `handleReshuffle` callback + state**

Open `src/components/room/AnnouncingView.tsx`. Find the existing block with `isOwner`, `isActiveDriver`, etc. derivations (near line 139–146 area). Add:

```ts
const canReshuffle =
  announcement?.currentAnnounceIdx === 0 &&
  announcement?.announcerPosition === 1 &&
  (announcement?.skippedUserIds ?? []).length === 0 &&
  !room.batchRevealMode;
```

Note: `room.batchRevealMode` was added to the `RoomShape` interface in R4 #2 Task 1. If the local interface here doesn't include it yet, add `batchRevealMode: boolean` to the interface.

Find the existing handler-callback block (near `handleSkipAnnouncer`, `handleRestoreSkipped` — likely around lines 240–315). Add a new state variable + handler:

```ts
const [reshuffling, setReshuffling] = useState(false);
const [reshuffleError, setReshuffleError] = useState<string | null>(null);

const handleReshuffle = useCallback(async () => {
  if (!isOwner || reshuffling) return;
  setReshuffling(true);
  setReshuffleError(null);
  try {
    const result = await patchAnnouncementOrder(roomId, currentUserId, {
      fetch: window.fetch.bind(window),
    });
    if (!result.ok) {
      setReshuffleError(
        result.error.code === "ANNOUNCE_IN_PROGRESS"
          ? t("roster.reshuffle.errorInProgress")
          : t("roster.reshuffle.errorGeneric"),
      );
    }
    // On success: the broadcast subscriber (Task 4) handles the refetch.
  } finally {
    setReshuffling(false);
  }
}, [currentUserId, isOwner, reshuffling, roomId, t]);
```

Add the import at the top of the file:

```ts
import { patchAnnouncementOrder } from "@/lib/room/api";
```

The `useTranslations` hook is already imported and `t` is in scope (existing pattern). If not, add `useTranslations` import + `const t = useTranslations();` near the other hooks.

- [ ] **Step 4: Pass new props to `<AnnouncerRoster>`**

Find the existing `<AnnouncerRoster ... />` JSX block (around line 657). Add the three new props at the end:

```tsx
<AnnouncerRoster
  members={members}
  presenceUserIds={presenceUserIds}
  currentAnnouncerId={announcement?.announcingUserId ?? null}
  delegateUserId={announcement?.delegateUserId ?? null}
  skippedUserIds={
    announcement?.skippedUserIds
      ? new Set(announcement.skippedUserIds)
      : undefined
  }
  onRestore={handleRestoreSkipped}
  restoringUserId={restoringUserId}
  onReshuffle={isOwner ? handleReshuffle : undefined}
  reshuffling={reshuffling}
  canReshuffle={isOwner && canReshuffle}
/>
```

- [ ] **Step 5: Render the error display below the roster**

Find the existing `restoreError` rendering block (around line 670–678). Add a sibling block immediately after for `reshuffleError`:

```tsx
{reshuffleError ? (
  <p
    role="alert"
    data-testid="reshuffle-error"
    className="text-xs text-destructive text-center"
  >
    {reshuffleError}
  </p>
) : null}
```

This sits just below the roster panel, next to the existing `restoreError` display. Same visual category, same a11y pattern.

- [ ] **Step 6: Run tests**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/AnnouncingView.test.tsx 2>&1 | tail -15
```

Expected: ALL PASS — 3 new + every existing.

- [ ] **Step 7: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/room/AnnouncingView.tsx src/components/room/AnnouncingView.test.tsx
git commit -m "$(cat <<'EOF'
feat(room): wire re-shuffle button + canReshuffle derivation (R4 #4)

Owner-branch derives canReshuffle from announcement state
(currentAnnounceIdx===0 AND announcerPosition===1 AND no skipped users
AND !batchRevealMode), passes it to <AnnouncerRoster> alongside the
onReshuffle handler that calls patchAnnouncementOrder. Inline error
display for ANNOUNCE_IN_PROGRESS 409 + generic failure, mirroring the
existing restoreError pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: announcement_order_reshuffled broadcast handler (TDD)

**Files:**
- Modify: `src/components/room/AnnouncingView.tsx`
- Modify: `src/components/room/AnnouncingView.test.tsx`

- [ ] **Step 1: Add 1 failing RTL test**

In `src/components/room/AnnouncingView.test.tsx`, find the existing tests that exercise `useRoomRealtime` events (search for `"announce_skip"` or `"announce_next"` in the test file — there should be a pattern for firing broadcasts via the mocked hook). Add a new test in the same style:

```ts
it("announcement_order_reshuffled event triggers refetch via onAnnouncementEnded", async () => {
  const onAnnouncementEnded = vi.fn();
  // Mock useRoomRealtime to capture the onMessage callback so we can fire events.
  // Adapt to whatever pattern the existing tests use — likely a vi.mock
  // for useRoomRealtime that captures the callback.

  render(
    <AnnouncingView
      room={makeRoomShape()}
      contestants={[]}
      currentUserId={OWNER_ID}
      announcement={{ ...validAnnouncement }}
      onAnnouncementEnded={onAnnouncementEnded}
    />,
  );

  // Fire the broadcast.
  fireRoomEvent({
    type: "announcement_order_reshuffled",
    announcementOrder: ["u1", "u2", "u3"],
    announcingUserId: "u1",
  });

  expect(onAnnouncementEnded).toHaveBeenCalled();
});
```

The exact mock-and-fire pattern depends on how the existing test file mocks `useRoomRealtime`. Read the existing tests for `announce_skip_restored` event handling (added in PR #89 area) — that's the closest sibling pattern.

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/AnnouncingView.test.tsx 2>&1 | tail -10
```

Expected: 1 FAIL — handler not registered.

- [ ] **Step 3: Add the broadcast handler**

In `src/components/room/AnnouncingView.tsx`, find the existing `useRoomRealtime(roomId, (event) => { ... })` block (around line 187). Add a new early-return case (place it near the existing `announce_skip_restored` handler for grouping):

```ts
if (event.type === "announcement_order_reshuffled") {
  // Server reshuffled the announcement order. Refetch room state so
  // the new active announcer + roster + position labels render
  // correctly for everyone in the room.
  onAnnouncementEnded?.();
  return;
}
```

Place it INSIDE the existing useRoomRealtime callback's chain of `if (event.type === ...)` blocks, alongside the others. Match the existing early-return style.

- [ ] **Step 4: Run test to verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/AnnouncingView.test.tsx 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Run all room tests for regression**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room 2>&1 | tail -10
```

Expected: ALL PASS.

- [ ] **Step 6: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/room/AnnouncingView.tsx src/components/room/AnnouncingView.test.tsx
git commit -m "$(cat <<'EOF'
feat(room): announcement_order_reshuffled broadcast subscriber (R4 #4)

Fills the gap left by PR #91 — the server broadcasts
announcement_order_reshuffled but no client subscribed. Now
<AnnouncingView>'s useRoomRealtime callback handles it the same way
as status_changed: triggers the room-state refetch via
onAnnouncementEnded so the new order, active announcer, and roster
render correctly for every connected client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Final cleanup — TODO tick + verifications + push approval gate

**Files:**
- Modify: `TODO.md` (tick line 267 — gitignored, local only)

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test 2>&1 | tail -5
```

Expected: ALL PASS.

- [ ] **Step 2: Type-check + lint**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3 && npm run lint 2>&1 | tail -5
```

Expected: type-check green, lint shows only pre-existing warnings (the `useRoomRealtime.ts` ref-cleanup warning that's unrelated to this branch).

- [ ] **Step 3: Tick TODO.md line 267**

Find the existing `[~]` line in `TODO.md`:

```markdown
  - [~] "Re-shuffle order" button (disabled once any advance has happened)  _(server path landed on `feat/r4-reshuffle-announcement-order` (PR #91)...)_
```

Change `[~]` to `[x]` and append a note about this slice:

```markdown
  - [x] "Re-shuffle order" button (disabled once any advance has happened)  _(server path landed on PR #91; UI shipped on `feat/r4-reshuffle-ui-button` — owner-only button in <AnnouncerRoster> header, hidden outside pre-first-reveal window (canReshuffle gate derived from announcement state). Plus the missing announcement_order_reshuffled broadcast subscriber in <AnnouncingView>. Spec: `docs/superpowers/specs/2026-05-11-r4-reshuffle-ui-button-design.md`. Plan: `docs/superpowers/plans/2026-05-11-r4-reshuffle-ui-button.md`.)_
```

(TODO.md is gitignored — no commit.)

- [ ] **Step 4: Pause for user push approval**

Push and PR are shared-state mutations. Stop here, summarise commits, and wait for explicit user approval before:

```bash
git push -u origin feat/r4-reshuffle-ui-button
gh pr create --title "feat(room): R4 #4 'Re-shuffle order' UI button (§10.2.1)" --body ...
```

PR body template (use when user approves):

```
## Summary

- Owner-only "Re-shuffle order" button in `<AnnouncerRoster>` header. Hidden entirely outside the narrow pre-first-reveal window (matches SPEC §10.2.1 wording).
- `canReshuffle` gate derived from announcement state in `<AnnouncingView>`: `currentAnnounceIdx===0 AND announcerPosition===1 AND skippedUserIds.length===0 AND !batchRevealMode`. Server enforces the same gate via `results.announced` count + returns ANNOUNCE_IN_PROGRESS 409 on race; UI gate is just to prevent doomed clicks.
- Inline busy/error state on the button (no confirmation modal — narrow window + reversible action).
- Missing `announcement_order_reshuffled` broadcast subscriber added to `<AnnouncingView>` (PR #91 shipped the server emit but no client subscribed).

UI-only slice. No schema, no endpoints, no orchestrator changes. Server path was PR #91.

## Test plan

- [ ] **No schema migration in this PR.** R4 #1 + R4 #2 migrations should already be applied.
- [ ] **Verify the button surfaces:** open `/room/{id}` as owner just after `scoring → announcing` transition (before any reveal). Roster panel should show "🎲 Re-shuffle order" button next to "here now" legend.
- [ ] **Tap the button:** announcement order changes (verify via roster panel + active announcer markers). The button should re-render with the same fresh state since no reveal has happened — repeat-tappable.
- [ ] **First reveal hides the button:** owner taps "Reveal next point" once → button disappears (currentAnnounceIdx becomes 1 → canReshuffle === false).
- [ ] **Race protection:** if two owners tap the reshuffle simultaneously, one gets ANNOUNCE_IN_PROGRESS error (visible inline beneath the roster).
- [ ] CI: `npm test`, `npm run type-check`, `npm run lint`, `npm run test:e2e`.
```

---

## Parallelization map

Strict order: 1 → 2 → 3 → 4 → 5.

- Task 1 (locale keys) is a chokepoint — Task 2 references the keys.
- Task 2 (button + RTL) precedes Task 3 (wiring) because Task 3's RTL test asserts on `roster-reshuffle` testid which is added in Task 2.
- Task 4 (broadcast handler) is independent of Task 3 in code but touches the same file (`<AnnouncingView>`); serial avoids merge conflicts within a single PR.
- Task 5 is final cleanup.

No parallelization opportunities — slice is small enough that serial execution adds minimal cost.

## Self-review checklist (run before declaring complete)

- [ ] `roster.reshuffle.{idleCta, busyCta, errorInProgress, errorGeneric}` keys exist in `src/locales/en.json`.
- [ ] `<AnnouncerRoster>` has 3 new optional props (`onReshuffle`, `reshuffling`, `canReshuffle`).
- [ ] `<AnnouncerRoster>` button renders ONLY when `onReshuffle && canReshuffle` are BOTH truthy.
- [ ] `<AnnouncingView>` derives `canReshuffle` correctly (4 conditions all needed).
- [ ] `handleReshuffle` short-circuits on `!isOwner || reshuffling` (defensive).
- [ ] `<AnnouncingView>` `useRoomRealtime` callback handles `announcement_order_reshuffled` via `onAnnouncementEnded?.()`.
- [ ] `reshuffleError` rendering uses `role="alert"` + `data-testid="reshuffle-error"` + `text-destructive`.
- [ ] `npm test` + `npm run type-check` + `npm run lint` all green.
- [ ] TODO.md line 267 ticked from `[~]` to `[x]` with branch + spec + plan refs.
