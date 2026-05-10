# R2 #239 "Who's here" Lobby Presence Indicators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing "Who's here" lobby avatar grid presence-aware. Members in the live `useRoomPresence` Set render with an emerald dot + full opacity; members not in the Set render with a grey dot + `opacity-50`.

**Architecture:** UI-only slice. `<LobbyView>` gains two new required props (`roomId`, `currentUserId`), calls `useRoomPresence` internally, and wraps each avatar in a presence-aware `<div>` with an absolute-positioned indicator dot. `page.tsx` plumbs the two values through. Because the new props are required, the LobbyView change and page.tsx wiring must land in the same commit — TypeScript would otherwise fail to compile.

**Tech Stack:** Next.js 14 App Router, React 18, Vitest + RTL with jsdom (per-file `// @vitest-environment jsdom`), Tailwind for styling.

**Spec:** [docs/superpowers/specs/2026-05-11-r2-whos-here-roster-design.md](../specs/2026-05-11-r2-whos-here-roster-design.md)

**Branch:** `feat/r2-whos-here-roster` — currently 1 commit ahead of main (spec doc, `a61c128`). Based on main with R4 #1, #2, #3 merged. R4 #4 (PR #98) is open but doesn't conflict with this slice.

**Existing helpers reused:**
- `useRoomPresence` at [src/hooks/useRoomPresence.ts](../../../src/hooks/useRoomPresence.ts) — already used by `<AnnouncingView>`, returns `Set<userId>` of currently-subscribed members; auto-cleans on heartbeat timeout (~30 s).
- Existing avatar grid at [src/components/room/LobbyView.tsx:333-353](../../../src/components/room/LobbyView.tsx#L333) — keep its outer structure, enhance the inner per-member block.
- Existing test helper `renderLobby(opts)` in `LobbyView.test.tsx` — add `roomId` and `currentUserId` to its `RenderOpts` shape.

---

## Task 1: LobbyView presence-aware roster + page.tsx wiring (TDD)

The LobbyView change and page.tsx wiring must land together because making the props required would otherwise break `tsc --noEmit`. Single commit.

**Files:**
- Modify: `src/components/room/LobbyView.tsx`
- Modify: `src/components/room/LobbyView.test.tsx`
- Modify: `src/app/room/[id]/page.tsx`

- [ ] **Step 1: Add failing RTL tests**

In `src/components/room/LobbyView.test.tsx`, add a `vi.mock` for `useRoomPresence` near the top of the file alongside the existing mocks (after the `Avatar` mock):

```ts
vi.mock("@/hooks/useRoomPresence", () => ({
  useRoomPresence: vi.fn(),
}));

import { useRoomPresence } from "@/hooks/useRoomPresence";
```

Update the `RenderOpts` interface and `renderLobby` helper to accept `roomId` and `currentUserId` (with defaults so existing tests continue to work without modification):

```ts
interface RenderOpts {
  // ...existing fields...
  roomId?: string;
  currentUserId?: string;
  presenceUserIds?: Set<string>;
}

function renderLobby(opts: RenderOpts = {}) {
  // Mock the presence hook return value PER TEST so cases can vary it.
  vi.mocked(useRoomPresence).mockReturnValue(
    opts.presenceUserIds ?? new Set(),
  );

  const onStartVoting = vi.fn();
  const onCopyPin = vi.fn();
  const onCopyLink = vi.fn();
  const ui = (
    <LobbyView
      pin="ABC123"
      ownerUserId={opts.ownerUserId ?? ALICE.userId}
      memberships={opts.memberships ?? [ALICE, BOB]}
      categories={opts.categoriesOverride ?? CATEGORIES}
      isAdmin={opts.isAdmin ?? true}
      startVotingState={opts.startVotingState ?? { kind: "idle" }}
      shareUrl="https://eurovisionmaxxing.com/room/r-1"
      onStartVoting={onStartVoting}
      onCopyPin={onCopyPin}
      onCopyLink={onCopyLink}
      onRefreshContestants={opts.onRefreshContestants}
      announcementMode={opts.announcementMode}
      onChangeAnnouncementMode={opts.onChangeAnnouncementMode}
      onChangeCategories={opts.onChangeCategories}
      roomId={opts.roomId ?? "r-1"}
      currentUserId={opts.currentUserId ?? ALICE.userId}
    />
  );
  return { ...render(ui), onStartVoting, onCopyPin, onCopyLink };
}
```

Then add a new `describe` block at the bottom of the file:

```ts
describe("<LobbyView> — presence indicators (R2 #239)", () => {
  it("renders online treatment for members in the presence Set", () => {
    renderLobby({
      memberships: [ALICE],
      presenceUserIds: new Set([ALICE.userId]),
    });
    const row = screen.getByTestId(`lobby-member-${ALICE.userId}`);
    expect(row).toHaveAttribute("data-online", "true");
    expect(row).not.toHaveClass("opacity-50");
  });

  it("renders offline treatment (opacity-50) for members not in the presence Set", () => {
    renderLobby({
      memberships: [BOB],
      presenceUserIds: new Set(), // empty
    });
    const row = screen.getByTestId(`lobby-member-${BOB.userId}`);
    expect(row).toHaveAttribute("data-online", "false");
    expect(row).toHaveClass("opacity-50");
  });

  it("preserves owner star regardless of online state", () => {
    renderLobby({
      memberships: [ALICE],
      ownerUserId: ALICE.userId,
      presenceUserIds: new Set(), // ALICE offline
    });
    expect(screen.getByText("★")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/LobbyView.test.tsx 2>&1 | tail -15
```

Expected: 3 new tests FAIL (testid not found / `roomId` prop unknown / hook not imported in component).

- [ ] **Step 3: Add the new props to `<LobbyView>`**

In `src/components/room/LobbyView.tsx`, find the `LobbyViewProps` interface (around line 41). Add at the end:

```ts
/**
 * SPEC §6.6.2 — required for the live presence channel subscription.
 */
roomId: string;
currentUserId: string;
```

Update the function signature destructuring (around line 91):

```ts
export default function LobbyView({
  pin,
  ownerUserId,
  memberships,
  categories,
  isAdmin,
  startVotingState,
  shareUrl,
  onStartVoting,
  onCopyPin,
  onCopyLink,
  onRefreshContestants,
  announcementMode,
  onChangeAnnouncementMode,
  onChangeCategories,
  roomId,
  currentUserId,
}: LobbyViewProps) {
```

- [ ] **Step 4: Import `useRoomPresence` and call it**

At the top of `src/components/room/LobbyView.tsx`, alongside existing imports:

```ts
import { useRoomPresence } from "@/hooks/useRoomPresence";
```

Inside the function body, near the top (after the existing `useMemo`/`useState` declarations or at the very top of the body):

```ts
const presenceUserIds = useRoomPresence(roomId, currentUserId);
```

- [ ] **Step 5: Replace the avatar grid block with presence-aware version**

In `src/components/room/LobbyView.tsx`, find the existing avatar grid at lines 338-351:

```tsx
{memberships.map((m) => (
  <div
    key={m.userId}
    className="flex flex-col items-center text-center space-y-1"
  >
    <Avatar seed={m.avatarSeed} size={64} />
    <p className="text-sm font-medium truncate w-full">
      {m.displayName}
      {m.userId === ownerUserId && (
        <span className="ml-1 text-xs text-primary">★</span>
      )}
    </p>
  </div>
))}
```

Replace with:

```tsx
{memberships.map((m) => {
  const isOnline = presenceUserIds.has(m.userId);
  return (
    <div
      key={m.userId}
      data-testid={`lobby-member-${m.userId}`}
      data-online={isOnline ? "true" : "false"}
      className={`flex flex-col items-center text-center space-y-1 transition-opacity ${
        isOnline ? "" : "opacity-50"
      }`}
    >
      <div className="relative">
        <Avatar seed={m.avatarSeed} size={64} />
        <span
          aria-hidden
          title={isOnline ? "Online" : "Offline"}
          className={`absolute bottom-0 right-0 inline-block w-3 h-3 rounded-full border-2 border-card ${
            isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
          }`}
        />
      </div>
      <p className="text-sm font-medium truncate w-full">
        {m.displayName}
        {m.userId === ownerUserId && (
          <span className="ml-1 text-xs text-primary">★</span>
        )}
      </p>
    </div>
  );
})}
```

The diff vs the existing version:
- Outer `<div>` gains `data-testid`, `data-online`, conditional `opacity-50` class.
- Avatar wrapped in a `relative`-positioned inner `<div>` with the absolute-positioned dot indicator.
- The `<p>` containing displayName + owner star is unchanged.

- [ ] **Step 6: Wire the new props in `page.tsx`**

In `src/app/room/[id]/page.tsx`, find the `<LobbyView ... />` JSX at line 575. Add the two new props at the end of the prop list (preserve all existing props):

```tsx
<LobbyView
  pin={phase.room.pin}
  ownerUserId={phase.room.ownerUserId}
  memberships={members}
  categories={phase.room.categories ?? []}
  isAdmin={isAdmin}
  startVotingState={startVotingState}
  shareUrl={shareUrl}
  onStartVoting={handleStartVoting}
  onCopyPin={handleCopyPin}
  onCopyLink={handleCopyLink}
  onRefreshContestants={isAdmin ? handleRefreshContestants : undefined}
  announcementMode={
    phase.room.announcementMode === "live" ||
    phase.room.announcementMode === "instant"
      ? phase.room.announcementMode
      : undefined
  }
  onChangeAnnouncementMode={
    isAdmin ? handleChangeAnnouncementMode : undefined
  }
  onChangeCategories={
    isAdmin ? handleChangeCategories : undefined
  }
  roomId={roomId}
  currentUserId={session.userId}
/>
```

The values `roomId` (from `params.id`) and `session.userId` are already in scope at this call site — no upstream plumbing needed. Verify by reading the surrounding context if uncertain.

- [ ] **Step 7: Run tests + type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/LobbyView.test.tsx 2>&1 | tail -15
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room 2>&1 | tail -5
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: ALL PASS — 3 new RTL cases + every existing LobbyView test (regression) + every other room component test + type-check clean.

- [ ] **Step 8: Smoke check (optional)**

If dev server is easy to start: `npm run dev`, navigate to a lobby, observe the presence dot on your own avatar (should be emerald). If a dev environment isn't readily available, skip this step.

- [ ] **Step 9: Commit**

```bash
git add src/components/room/LobbyView.tsx src/components/room/LobbyView.test.tsx src/app/room/[id]/page.tsx
git commit -m "$(cat <<'EOF'
feat(lobby): presence-aware "Who's here" roster (R2 §6.6.2)

LobbyView now calls useRoomPresence and wraps each avatar with a
presence-aware <div>: emerald dot + full opacity when the member is
in the Set, grey dot + opacity-50 otherwise. Reuses the same
visual language as <AnnouncerRoster>'s "here now" dot. The 30s
heartbeat timeout in useRoomPresence handles tab-close detection
without needing user_left broadcasts.

New required props (roomId, currentUserId) plumbed through page.tsx —
both values already in scope at the LobbyView render site.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Stage exactly the three modified files. Do NOT stage `.claire/`, `CLAUDE.md`, or `logo-preview.png` (pre-existing untracked files).

---

## Task 2: Final cleanup — TODO tick + verifications + push approval gate

**Files:**
- Modify: `TODO.md` (tick line 239 — gitignored, local only)

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

- [ ] **Step 3: Tick TODO.md line 239**

Find the existing `[ ]` line in `TODO.md`:

```markdown
- [ ] "Who's here" roster component — live presence via `user_joined`/`user_left` + 30s idle grey-out (§6.6.2). Also appears in compact form during `voting` (§8.x header).
```

Change to:

```markdown
- [x] "Who's here" roster component — live presence via `user_joined`/`user_left` + 30s idle grey-out (§6.6.2). Also appears in compact form during `voting` (§8.x header).  _(lobby surface landed on `feat/r2-whos-here-roster` — `<LobbyView>` calls `useRoomPresence`, renders emerald dot + full opacity when online, grey dot + opacity-50 when offline. Membership list (additive) and presence Set (live, auto-cleans on 30s heartbeat timeout) are complementary signals; no `user_left` broadcast needed. Voting-header compact roster deferred to a follow-up slice. Spec: `docs/superpowers/specs/2026-05-11-r2-whos-here-roster-design.md`. Plan: `docs/superpowers/plans/2026-05-11-r2-whos-here-roster.md`.)_
```

(TODO.md is gitignored — no commit.)

- [ ] **Step 4: Pause for user push approval**

Push and PR are shared-state mutations. Stop here, summarise commits, and wait for explicit user approval before:

```bash
git push -u origin feat/r2-whos-here-roster
gh pr create --title "feat(lobby): R2 #239 'Who's here' presence indicators (§6.6.2)" --body ...
```

PR body template (use when user approves):

```
## Summary

- `<LobbyView>` "Who's here" avatar grid now renders presence-aware: emerald dot + full opacity for members in `useRoomPresence`'s Set, grey dot + opacity-50 for members who closed their tab or lost connection.
- Reuses the existing `useRoomPresence` hook (PR #76, also used by `<AnnouncerRoster>`) — same `presence:{roomId}` channel, 30 s heartbeat timeout for offline detection.
- New required props `roomId` + `currentUserId` plumbed through `page.tsx`.
- Visual language matches `<AnnouncerRoster>`'s "here now" dot exactly — emerald 500 with `border-card` ring isolation.

UI-only slice. No new component (existing inline grid extended), no schema, no endpoints, no orchestrator changes, no locale keys. Voting-header compact roster (SPEC §6.6.2 last paragraph) deferred to a follow-up slice.

## Test plan

- [ ] **Verify online treatment:** open a lobby in two browsers as different users. Both avatars should show emerald dots + full opacity in each browser.
- [ ] **Verify offline timeout:** in one browser close the tab. Within ~30 s, that avatar in the other browser should grey out (opacity-50, grey dot).
- [ ] **Verify rejoin recovers:** reopen the closed tab. Avatar in the other browser should snap back to emerald + full opacity within a few seconds.
- [ ] **Verify owner star unaffected:** owner avatar still shows the ★ regardless of online state.
- [ ] CI: `npm test`, `npm run type-check`, `npm run lint`.
```

---

## Parallelization map

Strict order: 1 → 2.

Task 1 is a single tightly-coupled change (LobbyView + page.tsx must land together to typecheck). Task 2 is post-implementation cleanup. No parallelization opportunities — slice is small enough that sequential execution adds zero meaningful cost.

## Self-review checklist (run before declaring complete)

- [ ] `useRoomPresence` is called inside `<LobbyView>` with `roomId` and `currentUserId` from props.
- [ ] Avatar block has `data-testid="lobby-member-{userId}"` and `data-online="true"|"false"`.
- [ ] Online state has emerald dot + full opacity; offline state has grey dot + `opacity-50`.
- [ ] `<LobbyView>`'s `roomId` and `currentUserId` props are required (not optional) — TypeScript enforces page.tsx passes them.
- [ ] Owner star (★) renders regardless of online state.
- [ ] All existing LobbyView tests still pass (RegressionCheck).
- [ ] `npm test` + `npm run type-check` + `npm run lint` all green.
- [ ] TODO.md line 239 ticked from `[ ]` to `[x]` with branch + spec + plan refs.
