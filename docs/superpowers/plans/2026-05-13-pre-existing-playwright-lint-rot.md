# Pre-existing Playwright + Lint Rot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 2 pre-existing Playwright failures + 4 lint warnings surfaced during PR #114's pre-push verification. Ship as **two independent PRs** drawn around risk.

**Architecture:** PR 1 fixes a real race condition in `<DoneCeremony>` (two-signal coordination between `<LeaderboardCeremony>`'s settle callback and the `/api/results` fetch) plus a 1-line Playwright locator regex made obsolete by the post-i18n button shape. PR 2 is mechanical lint hygiene: add `t` to two hook dep arrays + adopt the standard ref-cleanup pattern in two realtime hooks.

**Tech Stack:** React 18 / Next.js 14 / TypeScript strict / next-intl / vitest (jsdom for RTL) / Playwright (chromium, port 3457).

**Spec:** [docs/superpowers/specs/2026-05-13-pre-existing-playwright-lint-rot-design.md](../specs/2026-05-13-pre-existing-playwright-lint-rot-design.md)

**Branches:**
- PR 1: `fix/playwright-pre-existing-failures` (currently checked out; spec commit `bdfbce1` already landed)
- PR 2: `chore/lint-rot-fixes` (branched fresh from `origin/main` after PR 1's verification gate)

---

## File map

### PR 1 — Playwright failures

**Modify:**
- `src/components/room/DoneCeremony.tsx` — replace single-shot `onAfterSettle` with a two-signal coordination (`settled` state + deferred `useEffect` transition)
- `src/components/room/DoneCeremony.test.tsx` — add 2 RTL cases pinning the deferred-transition path
- `tests/e2e/announce-short-style-chooser.spec.ts` — 1-line locator change

### PR 2 — Lint warnings

**Modify:**
- `src/app/create/page.tsx` — add `t` to the contestants-fetch `useEffect` dep array (line 149)
- `src/components/room/AnnouncingView.tsx` — add `t` to the `handleReshuffle` `useCallback` dep array (line 386)
- `src/hooks/useRoomPresence.ts` — copy `supabase.current` to a local at effect-entry; use it in setup + cleanup
- `src/hooks/useRoomRealtime.ts` — same pattern

**Unchanged across both PRs:**
- `src/components/instant/LeaderboardCeremony.tsx` — `onAfterSettle` contract is unchanged
- API routes, schema, realtime payloads, locale bundles

---

# PR 1 — `fix/playwright-pre-existing-failures`

## PR 1 Task 1 — `<DoneCeremony>` two-signal race fix + RTL coverage

**Why first:** the product-code bug is the load-bearing fix. RTL cases ship in the same commit since they exercise the new state coordination.

**Files:**
- Modify: `src/components/room/DoneCeremony.tsx`
- Modify: `src/components/room/DoneCeremony.test.tsx`

- [ ] **Step 1.1: Edit `src/components/room/DoneCeremony.tsx` — introduce `settled` state + deferred-transition `useEffect`**

Read the file first (currently 145 lines) to confirm the structure matches the find-strings. If anything has drifted, STOP and report.

**Edit A** — add a `settled` state alongside the existing `phase` state. Find:

```tsx
  const [data, setData] = useState<DoneFixture | null>(null);
  const [phase, setPhase] = useState<Phase>("leaderboard");
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
```

Replace with:

```tsx
  const [data, setData] = useState<DoneFixture | null>(null);
  const [phase, setPhase] = useState<Phase>("leaderboard");
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  /**
   * Two-signal coordination: <LeaderboardCeremony>'s onAfterSettle fires
   * synchronously when its replay-skip flag is set, but our `data` fetch
   * may not have resolved yet. Flipping `settled` here keeps the
   * transition deferred until both signals are present (see the effect
   * below).
   */
  const [settled, setSettled] = useState(false);
```

**Edit B** — add the deferred-transition `useEffect` AFTER the `useMemo` for `textSummary` and BEFORE the first `if (phase === "leaderboard")` branch. Find:

```tsx
  const textSummary = useMemo(() => {
    if (!data) return "";
    return formatRoomSummary({
      year: data.year,
      event: data.event,
      leaderboard: data.leaderboard,
      contestants: data.contestants,
      shareUrl,
      labels: {
        eventTitle: (year, event) => t(`eventTitle.${event}`, { year }),
        topLine: t("results.summary.topLine"),
        fullResults: t("results.summary.fullResults"),
      },
    });
  }, [data, shareUrl, t]);

  if (phase === "leaderboard") {
```

Replace with:

```tsx
  const textSummary = useMemo(() => {
    if (!data) return "";
    return formatRoomSummary({
      year: data.year,
      event: data.event,
      leaderboard: data.leaderboard,
      contestants: data.contestants,
      shareUrl,
      labels: {
        eventTitle: (year, event) => t(`eventTitle.${event}`, { year }),
        topLine: t("results.summary.topLine"),
        fullResults: t("results.summary.fullResults"),
      },
    });
  }, [data, shareUrl, t]);

  // Phase transition gate. Both halves of the race must complete before
  // we leave the leaderboard phase:
  //   1. <LeaderboardCeremony> has finished its cinematic and flipped `settled`.
  //   2. The /api/results fetch has populated `data` (and therefore `sequence`).
  // Without this gate, an instant LeaderboardCeremony settle (e.g. the
  // replay-skip flag is set) races the fetch and fast-forwards to "ctas"
  // with sequence === [], silently skipping every awards card.
  useEffect(() => {
    if (!settled) return;
    if (phase !== "leaderboard") return;
    if (!data) return;
    setPhase(sequence.length === 0 ? "ctas" : "awards");
  }, [settled, data, sequence, phase]);

  if (phase === "leaderboard") {
```

**Edit C** — simplify the `<LeaderboardCeremony>` callback to just flip the `settled` flag. Find:

```tsx
  if (phase === "leaderboard") {
    return (
      <LeaderboardCeremony
        roomId={roomId}
        onAfterSettle={() =>
          setPhase(sequence.length === 0 ? "ctas" : "awards")
        }
      />
    );
  }
```

Replace with:

```tsx
  if (phase === "leaderboard") {
    return (
      <LeaderboardCeremony
        roomId={roomId}
        onAfterSettle={() => setSettled(true)}
      />
    );
  }
```

- [ ] **Step 1.2: Add 2 RTL cases pinning the race-fix behaviour**

Edit `src/components/room/DoneCeremony.test.tsx`. The mock `@/lib/instant/sessionRevealedFlag.hasRevealed` returns `true` (line 22 in the existing test), which makes `<LeaderboardCeremony>` skip its cinematic and fire `onAfterSettle` synchronously. The existing tests rely on this. To exercise the new deferred-transition path, we need to control the fetch timing.

Find the last existing test (`"admin sees Create another room CTA"` block ending around line 168). After its closing `});` (and before the final closing `});` of the outer `describe`), append the two new cases:

```tsx
  it("defers phase transition when LeaderboardCeremony settles before data arrives", async () => {
    // Block the fetch until we explicitly resolve it. This recreates the
    // race the spec describes: LeaderboardCeremony fires onAfterSettle()
    // synchronously (sessionRevealedFlag mock returns true), but the
    // /api/results fetch hasn't returned yet, so `data` is still null.
    let resolveFetch!: (value: unknown) => void;
    const pendingFetch = new Promise((res) => {
      resolveFetch = res;
    });
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => {
            await pendingFetch;
            return FIXTURE;
          },
        }) as unknown as Response,
    ) as unknown as typeof fetch;

    render(
      <DoneCeremony
        roomId="r"
        isAdmin={false}
        categories={[{ name: "Vocals", weight: 1 }]}
      />,
    );

    // After mount, LeaderboardCeremony settles synchronously (replay-skip
    // path). But data is still pending, so the phase MUST remain on the
    // leaderboard view — awards-section copy must NOT appear yet.
    await flushMicrotasks();
    expect(screen.queryByText("Best Vocals")).not.toBeInTheDocument();

    // Now resolve the fetch. The data + sequence land, the deferred
    // useEffect fires, and the phase advances to awards.
    resolveFetch(undefined);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(await screen.findByText("Best Vocals")).toBeInTheDocument();
  });

  it("transitions immediately when data arrives before LeaderboardCeremony settles", async () => {
    // Happy path: fetch resolves fast (mocked synchronously). Existing
    // 'walks leaderboard → awards → ctas' test already covers this — but
    // we re-pin it explicitly here to guard against the deferred-
    // transition useEffect mis-firing when both signals are already
    // present at the same render tick.
    mockFetch();
    render(
      <DoneCeremony
        roomId="r"
        isAdmin={false}
        categories={[{ name: "Vocals", weight: 1 }]}
      />,
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(await screen.findByText("Best Vocals")).toBeInTheDocument();
  });
```

- [ ] **Step 1.3: Run tests, verify all pass**

```bash
npx vitest run src/components/room/DoneCeremony.test.tsx
```

Expected: ALL tests PASS (3 existing + 2 new = 5 total).

- [ ] **Step 1.4: Type-check**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 1.5: Commit**

```bash
git add src/components/room/DoneCeremony.tsx src/components/room/DoneCeremony.test.tsx
git commit -m "$(cat <<'EOF'
fix(awards): DoneCeremony defers phase transition until data lands

Two-signal coordination replaces the single-shot inline onAfterSettle
callback. Previously, when <LeaderboardCeremony>'s replay-skip flag
fired its onAfterSettle synchronously, the callback read `sequence`
from its closure — and if /api/results hadn't returned yet, `sequence`
was [], so the phase fast-forwarded to "ctas" and silently skipped
every awards card.

New shape: <LeaderboardCeremony>'s callback just flips a `settled`
boolean. A separate useEffect transitions the phase only when BOTH
`settled === true` AND `data !== null`. Happy path (fetch resolves
fast) is unchanged byte-for-byte; the race path now correctly waits.

2 new RTL cases pin both timing orderings:
- LeaderboardCeremony settles before data: phase stays on leaderboard
  until fetch resolves, then advances to awards.
- Data arrives before LeaderboardCeremony settles: existing happy
  path, re-pinned defensively.

Surfaced by awards-ceremony.spec.ts:18 Playwright failure, which
will start passing in CI once this lands. your-neighbour-award.spec.ts
keeps its test.describe.skip(...) block (will be unskipped in a
follow-up — out of this slice's scope).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## PR 1 Task 2 — Chooser test locator fix

**Why second:** independent 1-line test-only change.

**Files:**
- Modify: `tests/e2e/announce-short-style-chooser.spec.ts`

- [ ] **Step 2.1: Update both `getByRole` calls**

Find (around lines 102-105):

```ts
    // Step 2: announcement mode picker. Select Live.
    await expect(page.getByRole("button", { name: /^Live$/ })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /^Live$/ }).click();
```

Replace with:

```ts
    // Step 2: announcement mode picker. Select Live. The button's
    // accessible name includes the tagline post-i18n migration, so
    // anchor to the start with a word boundary instead of exact-match.
    const liveCard = page.getByRole("button", { name: /^Live\b/ });
    await expect(liveCard).toBeVisible({ timeout: 10_000 });
    await liveCard.click();
```

- [ ] **Step 2.2: Type-check + list the test**

```bash
npm run type-check
```

Expected: PASS.

```bash
npx playwright test --list tests/e2e/announce-short-style-chooser.spec.ts
```

Expected: spec listed with 1 active test. DO NOT execute the suite here — Task 3's verification gate runs everything against the dev server.

- [ ] **Step 2.3: Commit**

```bash
git add tests/e2e/announce-short-style-chooser.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): fix chooser-spec locator for post-i18n Live button name

getByRole('button', { name: /^Live$/ }) returned nothing because the
post-i18n <AnnouncementModeCard> now renders the tagline inside the
same <button> as the "Live" label. Accessible name became multiline:
"Live\nTake turns announcing your points, Eurovision-style." — the
exact-match regex rejected it.

Loosened to /^Live\b/ — matches the "Live" prefix with a word boundary
(rejects "Instant" and any unrelated button). Same locator applied to
both the visibility assertion and the click.

Surfaced by full-Playwright-suite runs (CI only runs vitest, so this
rotted silently after the i18n migration landed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## PR 1 Task 3 — Verification, push, open PR

**Why last:** confirm both fixes land cleanly + the suite is fully green from a cold dev server before pushing.

- [ ] **Step 3.1: Full vitest suite**

```bash
npm test
```

Expected: ALL tests PASS (baseline ~1740 + 2 new from Task 1.2 = ~1742).

If any non-passing test surfaces, STOP and report.

- [ ] **Step 3.2: Start dev server on port 3457 for Playwright**

```bash
npm run dev -- --port 3457
```
(background)

Wait for readiness:

```bash
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3457/api/health | grep -q "200"; do sleep 2; done; echo "DEV_SERVER_READY"
```

- [ ] **Step 3.3: Full Playwright suite**

```bash
npx playwright test --reporter=list
```

Expected outcome: the 2 cases this PR targets MUST flip RED → GREEN:
- `tests/e2e/announce-short-style-chooser.spec.ts:70` — was FAIL, now PASS
- `tests/e2e/awards-ceremony.spec.ts:18` — was FAIL, now PASS

No other case should regress. Total pass count should be the baseline + 2. The 4 cases in `your-neighbour-award.spec.ts` STAY SKIPPED (still inside `test.describe.skip(...)`); unskipping them is a follow-up.

If any other case fails (regression), STOP and investigate via the trace at `test-results/<case>/trace.zip`.

- [ ] **Step 3.4: Stop the dev server**

```bash
kill $(lsof -ti:3457) 2>/dev/null || true
```

- [ ] **Step 3.5: Type-check + lint**

```bash
npm run type-check && npm run lint
```

Expected: type-check PASS. Lint: the 4 pre-existing warnings should still be present (PR 2 fixes them). NO new warnings introduced.

- [ ] **Step 3.6: Push + open PR**

```bash
git push -u origin fix/playwright-pre-existing-failures
```

Then open the PR via `gh pr create`. PR title: `fix(awards): DoneCeremony race + chooser locator (Playwright suite green)`. Body:

```
## Summary

- **DoneCeremony race fix** — `<LeaderboardCeremony>`'s `onAfterSettle` (which fires synchronously when the replay-skip flag is set) was racing the `/api/results` fetch. If `data` was still null when the callback fired, `sequence === []` and the phase fast-forwarded to `"ctas"`, silently skipping all awards cards. New two-signal coordination defers the phase transition until BOTH `settled === true` AND `data !== null`.
- **Chooser spec locator fix** — post-i18n `<AnnouncementModeCard>` now renders the tagline inside the same `<button>` as the "Live" label. The exact-match `/^Live$/` regex stopped matching. Loosened to `/^Live\b/`.

## Test coverage

- **Vitest**: 2 new RTL cases on `<DoneCeremony>` pin both timing orderings (`settled` before `data` and vice-versa).
- **Playwright**: `awards-ceremony.spec.ts:18` and `announce-short-style-chooser.spec.ts:70` both go RED → GREEN. Full Playwright suite passes against a local dev server.
- Type-check + lint clean (lint still has 4 pre-existing warnings — PR 2 fixes those).

## Out of scope (separate slices)
- Adding Playwright to CI.
- Unskipping `your-neighbour-award.spec.ts`'s 4 cases (mechanical follow-up once this lands).
- The 4 pre-existing lint warnings — see `chore/lint-rot-fixes` PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

# PR 2 — `chore/lint-rot-fixes`

## PR 2 Task 1 — Branch from latest `origin/main`

**Why first:** PR 2 ships independently of PR 1. Branch from the latest `origin/main` so the lint cleanup applies to the file state CI is currently seeing.

- [ ] **Step 4.1: Fetch latest + branch**

```bash
git fetch origin main --quiet
git checkout -b chore/lint-rot-fixes origin/main
```

Verify:

```bash
git log --oneline origin/main..HEAD
```

Expected: empty (branch tip equals `origin/main`).

```bash
npm run lint 2>&1 | tail -20
```

Expected: 4 warnings (the ones this PR fixes):
- `src/app/create/page.tsx:149`
- `src/components/room/AnnouncingView.tsx:386`
- `src/hooks/useRoomPresence.ts:61`
- `src/hooks/useRoomRealtime.ts:30`

If a different count surfaces, the baseline drifted — investigate before continuing.

## PR 2 Task 2 — Add `t` to `useEffect` deps in `src/app/create/page.tsx`

**Files:**
- Modify: `src/app/create/page.tsx`

- [ ] **Step 5.1: Edit the dep array**

Read the file around line 149 first. The `useEffect` ends with `}, [year, event]);`. ESLint flags `t` as missing because the error branch uses `t("create.eventSelection.error")`.

Find (around lines 149):

```ts
    return () => {
      clearTimeout(debounce);
      if (slowTimer) clearTimeout(slowTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      controller.abort();
    };
  }, [year, event]);
```

Replace with:

```ts
    return () => {
      clearTimeout(debounce);
      if (slowTimer) clearTimeout(slowTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      controller.abort();
    };
  }, [year, event, t]);
```

- [ ] **Step 5.2: Verify lint count drops by 1**

```bash
npm run lint 2>&1 | grep -c "Warning:"
```

Expected: `3` (one fewer than baseline).

- [ ] **Step 5.3: Vitest spot-check**

```bash
npx vitest run src/app/create
```

Expected: any existing tests under `src/app/create` still PASS (or empty success if no tests there).

- [ ] **Step 5.4: Type-check**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/app/create/page.tsx
git commit -m "$(cat <<'EOF'
fix(lint): add t to contestants-fetch useEffect deps in /create

ESLint flagged the dependency array as incomplete because the
error branch calls t('create.eventSelection.error') inside the
effect. The `t` from useTranslations() is referentially stable per
next-intl's contract, so adding it to deps is a no-op behaviourally
— but silences the react-hooks/exhaustive-deps warning.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## PR 2 Task 3 — Add `t` to `useCallback` deps in `<AnnouncingView>`

**Files:**
- Modify: `src/components/room/AnnouncingView.tsx`

- [ ] **Step 6.1: Edit the dep array**

The `handleReshuffle` `useCallback` calls `t("announcing.roster.reshuffleErrorInProgress")` and `t("announcing.roster.reshuffleErrorGeneric")` but `t` is not in the deps.

Find (around lines 367-386, ending with the closing `}, [...]);`):

```ts
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
          result.code === "ANNOUNCE_IN_PROGRESS"
            ? t("announcing.roster.reshuffleErrorInProgress")
            : t("announcing.roster.reshuffleErrorGeneric"),
        );
      }
      // On success: the broadcast subscriber handles the refetch.
    } finally {
      setReshuffling(false);
    }
  }, [currentUserId, isOwner, reshuffling, roomId]);
```

Replace with:

```ts
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
          result.code === "ANNOUNCE_IN_PROGRESS"
            ? t("announcing.roster.reshuffleErrorInProgress")
            : t("announcing.roster.reshuffleErrorGeneric"),
        );
      }
      // On success: the broadcast subscriber handles the refetch.
    } finally {
      setReshuffling(false);
    }
  }, [currentUserId, isOwner, reshuffling, roomId, t]);
```

- [ ] **Step 6.2: Run existing AnnouncingView tests**

```bash
npx vitest run src/components/room/AnnouncingView.test.tsx
```

Expected: all PASS (baseline 42 cases).

- [ ] **Step 6.3: Lint check**

```bash
npm run lint 2>&1 | grep -c "Warning:"
```

Expected: `2` (down from 3).

- [ ] **Step 6.4: Type-check**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/room/AnnouncingView.tsx
git commit -m "$(cat <<'EOF'
fix(lint): add t to handleReshuffle useCallback deps

The reshuffle handler maps the ANNOUNCE_IN_PROGRESS code to a
translated error string via t(...). t was missing from the deps
array; ESLint's react-hooks/exhaustive-deps rule flagged it. t from
useTranslations() is stable across renders per next-intl's contract,
so adding it changes nothing behaviourally — just silences the
warning.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## PR 2 Task 4 — Copy `supabase.current` to local in `useRoomPresence`

**Files:**
- Modify: `src/hooks/useRoomPresence.ts`

- [ ] **Step 7.1: Read the file to find the `useEffect` block**

The pattern: at the top of the effect, copy `supabase.current` into a local `const client`, use `client` instead of `supabase.current` throughout the effect, and use `client` in the cleanup so the closure captures a stable reference.

Read the file (it's small — ~65 lines). The relevant block is around lines 30-63 (the `useEffect` that sets up the presence channel and returns a cleanup).

- [ ] **Step 7.2: Apply the standard ref-cleanup pattern**

Find the existing useEffect block. The block currently looks like (approximate — confirm via Read first):

```ts
  useEffect(() => {
    if (!roomId || !userId) return;

    const channel = supabase.current
      .channel(`presence:${roomId}`, { ... })
      // ... setup ...
      .on(...)
      .subscribe(async (status) => { ... });

    return () => {
      void supabase.current.removeChannel(channel);
    };
  }, [roomId, userId]);
```

Update it to copy the ref at the top:

```ts
  useEffect(() => {
    if (!roomId || !userId) return;

    // Copy the ref value into a local so the cleanup closure captures a
    // stable reference. supabase.current is set once at mount but ESLint
    // flags any read of `.current` from a cleanup as potentially stale.
    const client = supabase.current;

    const channel = client
      .channel(`presence:${roomId}`, { ... })
      // ... setup ...
      .on(...)
      .subscribe(async (status) => { ... });

    return () => {
      void client.removeChannel(channel);
    };
  }, [roomId, userId]);
```

(The actual `.channel(...)` arguments and `.on()` chain are unchanged — only the `supabase.current` reads inside the effect become `client`.)

If, after reading the file, the find-string doesn't match exactly, do the minimal substitution: at the top of the `useEffect` body (just after the early-return), add `const client = supabase.current;`. Then replace every subsequent occurrence of `supabase.current` inside the effect body (including the cleanup) with `client`.

- [ ] **Step 7.3: Lint check**

```bash
npm run lint 2>&1 | grep -c "Warning:"
```

Expected: `1` (only the `useRoomRealtime` warning remains).

- [ ] **Step 7.4: Existing-test smoke**

```bash
npx vitest run src/hooks 2>&1 | tail -5
```

Expected: any existing tests under `src/hooks/` PASS (or empty success). The hook is presence-related and may not have unit tests; that's fine.

- [ ] **Step 7.5: Type-check**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add src/hooks/useRoomPresence.ts
git commit -m "$(cat <<'EOF'
fix(lint): copy supabase.current to local in useRoomPresence cleanup

ESLint's react-hooks/exhaustive-deps rule flagged supabase.current
in the cleanup as potentially stale. supabase is a useRef whose
current value never reassigns after the initial useRef(createClient())
call, so this is theoretically safe today — but the standard
pattern is to copy the ref into a local at effect-entry so the
cleanup closure captures the same reference the setup used.

No behavioural change; just silences the warning.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## PR 2 Task 5 — Copy `supabase.current` to local in `useRoomRealtime`

**Files:**
- Modify: `src/hooks/useRoomRealtime.ts`

- [ ] **Step 8.1: Apply the same pattern**

Find the existing block (around lines 19-32):

```ts
  useEffect(() => {
    if (!roomId) return;

    const channel = supabase.current
      .channel(`room:${roomId}`)
      .on("broadcast", { event: "room_event" }, (payload) => {
        callbackRef.current(payload.payload as RoomEvent);
      })
      .subscribe();

    return () => {
      supabase.current.removeChannel(channel);
    };
  }, [roomId]);
```

Replace with:

```ts
  useEffect(() => {
    if (!roomId) return;

    // Copy the ref value into a local so the cleanup closure captures a
    // stable reference. Mirrors the pattern in useRoomPresence.
    const client = supabase.current;

    const channel = client
      .channel(`room:${roomId}`)
      .on("broadcast", { event: "room_event" }, (payload) => {
        callbackRef.current(payload.payload as RoomEvent);
      })
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [roomId]);
```

- [ ] **Step 8.2: Lint check (full clear)**

```bash
npm run lint 2>&1 | tail -10
```

Expected: `0 warnings` (or only outputs "next lint" header + no warning lines). The 4 pre-existing warnings should now all be gone.

- [ ] **Step 8.3: Run tests touched by the realtime hook**

```bash
npx vitest run src/hooks
```

Expected: any existing tests still PASS.

```bash
npx vitest run src/components/room/AnnouncingView.test.tsx
```

Expected: 42 cases PASS (AnnouncingView consumes `useRoomRealtime`).

- [ ] **Step 8.4: Type-check**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add src/hooks/useRoomRealtime.ts
git commit -m "$(cat <<'EOF'
fix(lint): copy supabase.current to local in useRoomRealtime cleanup

Same pattern as useRoomPresence: copy the ref into a local at
effect-entry, use it throughout, and reference it in cleanup so the
closure captures a stable supabase client.

This was the last of the 4 pre-existing react-hooks/exhaustive-deps
warnings flagged in the lint baseline. After this commit, npm run
lint reports 0 warnings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## PR 2 Task 6 — Verification, push, open PR

- [ ] **Step 9.1: Full vitest suite**

```bash
npm test
```

Expected: ALL tests PASS (baseline count unchanged — PR 2 adds no new tests).

- [ ] **Step 9.2: Dev server + full Playwright suite**

```bash
npm run dev -- --port 3457
```
(background)

Wait for readiness:
```bash
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3457/api/health | grep -q "200"; do sleep 2; done; echo "DEV_SERVER_READY"
```

Run Playwright:
```bash
npx playwright test --reporter=list
```

Expected: behaviour matches `origin/main` — same number of failing/passing/skipped. If PR 1 is already merged when this runs, expect the 2 cases from PR 1 to also be GREEN; if not, the 2 PR-1-targeted failures will still be RED on this branch (PR 2 doesn't touch them). Either way, PR 2 must NOT introduce any new failures.

- [ ] **Step 9.3: Stop dev server**

```bash
kill $(lsof -ti:3457) 2>/dev/null || true
```

- [ ] **Step 9.4: Final lint + type-check**

```bash
npm run type-check && npm run lint
```

Expected: type-check PASS. Lint: **0 warnings**.

- [ ] **Step 9.5: Push + open PR**

```bash
git push -u origin chore/lint-rot-fixes
```

Open via `gh pr create`. Title: `chore(lint): clear 4 pre-existing react-hooks/exhaustive-deps warnings`. Body:

```
## Summary

Clears all 4 pre-existing `react-hooks/exhaustive-deps` warnings reported by `npm run lint`. No behavioural change in any file.

- `src/app/create/page.tsx:149` — add `t` to the contestants-fetch `useEffect` deps.
- `src/components/room/AnnouncingView.tsx:386` — add `t` to `handleReshuffle`'s `useCallback` deps.
- `src/hooks/useRoomPresence.ts:61` — copy `supabase.current` to a local at effect-entry; use it in the cleanup closure.
- `src/hooks/useRoomRealtime.ts:30` — same pattern.

`t` from `useTranslations()` is referentially stable per next-intl's contract, so the dep additions are no-ops behaviourally. The `supabase` ref is set once at mount via `useRef(createClient())` and never reassigned, so the copy-to-local is also a no-op — but it adopts the standard react-hooks/exhaustive-deps pattern.

## Test coverage

- **Vitest**: full suite still passes (no test changes).
- **Playwright**: behaviour unchanged. If PR 1 has merged before this runs, the suite is fully green.
- **Lint**: 0 warnings after this PR.

## Out of scope
- The 2 Playwright failures (`awards-ceremony.spec.ts`, `announce-short-style-chooser.spec.ts`) — see PR `fix/playwright-pre-existing-failures`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
