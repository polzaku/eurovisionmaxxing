# Host UX Batch Fix Implementation Plan (2026-05-14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six unrelated host-side UX bugs that landed during live-event smoke. Each fix is independent and ships in its own commit. RTL tests are mandatory per SPEC §17a.5; one Playwright spec covers the two highest-visibility flows.

**Architecture:** All fixes are localized — no server schema changes, no broadcast contract changes. Fix 5 is the only one that touches the realtime fallback path and ships an additive polling hook. Fix 4 adds locale keys and routes existing fields through `t()`; no server data migrations.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript strict, `next-intl@^3`, Vitest + RTL (jsdom pragma), Playwright (Chromium only).

---

## Fix 1 — Move host "End voting" CTA below the nav footer

**Why:** SPEC §8.1 places locale switcher + theme toggle in the header area; the destructive End Voting button is rendered into the same right-side stack at [src/components/voting/VotingView.tsx:375-385](src/components/voting/VotingView.tsx#L375-L385), overlapping the chrome on small viewports.

**Files:**
- Modify: `src/components/voting/VotingView.tsx` — drop the conditional `<Button variant="destructive">` from the header stack; render a new full-width row immediately below the existing `<nav className="grid grid-cols-4 ...">` (lines 470–514) when `onEndVoting` is provided AND status is not `voting_ending` (no `<EndingPill>` overlap).
- Test: `src/components/voting/VotingView.test.tsx` — new file (none currently exists).

**Steps:**

- [ ] Write the failing RTL test: render `<VotingView>` with `onEndVoting` set and assert the End Voting button appears (a) NOT inside the header element and (b) after the nav footer in DOM order. Also assert a second render without `onEndVoting` does not render the button.
- [ ] Run the test, confirm both cases fail.
- [ ] Edit `VotingView.tsx`: remove the `onEndVoting ?` block at lines 376–385; add a new `{onEndVoting && (...)}` block immediately after the closing `</nav>` (line 514) rendering a full-width `<Button variant="destructive">` with the same `aria-label` + label keys. Keep margin top tight (e.g. `mt-2`).
- [ ] Re-run; tests pass.
- [ ] Commit.

---

## Fix 2 — Last announcer never sees their 12-pt allocation

**Why:** [AnnouncingView.tsx:315-331](src/components/room/AnnouncingView.tsx#L315-L331) flips `finishedLocal=true` synchronously when `result.data.finished` returns true, immediately swapping to `<DoneCard>`. Concurrently the server broadcasts `status_changed:done`, which fires the page-level `loadRoom()` and renders `<DoneCeremony>` (LeaderboardCeremony then AwardsCeremony). The announcer's `<JustRevealedFlash>` card (4.5 s timer) is never visible because the parent component unmounts.

**Files:**
- Modify: `src/components/room/AnnouncingView.tsx` — defer `setFinishedLocal(true)` by `FINAL_REVEAL_DWELL_MS` (constant, 4000 ms).
- Modify: `src/app/room/[id]/page.tsx` — when the `status_changed` event reports `done` AND the page's previous status was `announcing`, defer the `loadRoom()` call by the same dwell.
- Test (RTL): `src/components/room/AnnouncingView.test.tsx` — extend (or create) with a fake-timer test that drives the final reveal and asserts the JustRevealedFlash stays mounted for the dwell before DoneCard swaps in.

**Steps:**

- [ ] Write the failing RTL test: mock `postAnnounceNext` to return `{ ok:true, data:{ finished:true } }`. Render `<AnnouncingView>` in active-driver mode. Tap reveal. Assert `JustRevealedFlash` (`data-testid="just-revealed-flash"` — add the attribute as part of this fix) is visible immediately and `DoneCard` is NOT mounted. Advance fake timers by 4000 ms; assert `DoneCard` is now mounted.
- [ ] Run, confirm fail.
- [ ] Edit `AnnouncingView.tsx`: introduce `const FINAL_REVEAL_DWELL_MS = 4000;`. In `handleReveal`, replace `if (result.data?.finished) setFinishedLocal(true);` with `setTimeout(() => setFinishedLocal(true), FINAL_REVEAL_DWELL_MS);`. Track the timer ref so unmount cleans it up. Add `data-testid="just-revealed-flash"` to the flash card.
- [ ] Edit `page.tsx`: track the previous `phase.room.status` in a ref. In the `status_changed` handler, if `event.status === "done"` and `prevStatus.current === "announcing"`, call `setTimeout(() => void loadRoom(), 4000)`; otherwise call `void loadRoom()` as today.
- [ ] Re-run; tests pass.
- [ ] Commit.

---

## Fix 5 — Some clients don't auto-advance from `voting` to `announcing`

**Why:** [useRoomRealtime.ts:11-37](src/hooks/useRoomRealtime.ts#L11-L37) is broadcast-only; if a guest's connection blips during the brief `voting_ending → scoring → announcing` window, they hold the stale `voting` view until manual refresh. SPEC §15 calls out Postgres Changes as a fallback; cheapest fix is a short-interval `/api/rooms/{id}` refetch poll during transient statuses, plus a refetch on `visibilitychange`.

**Files:**
- Create: `src/hooks/useRoomStatusPolling.ts` — pure hook that takes `roomId`, current status, `loadRoom`. Polls every 3 s while status is `voting_ending` or `scoring`; refetches on `visibilitychange → visible` for non-terminal statuses; no-op on `lobby` / `done`.
- Test: `src/hooks/useRoomStatusPolling.test.ts` — table tests with fake timers.
- Modify: `src/app/room/[id]/page.tsx` — wire the hook after `useRoomRealtime`.

**Steps:**

- [ ] Write the failing test for the new hook: mount with status `voting_ending`, advance timers by 3 s, assert `loadRoom` was called once. Advance another 3 s, called twice. Change status to `done`, advance timers, no further calls. Also test visibilitychange dispatch triggers exactly one extra call when status is `voting`.
- [ ] Run, confirm fail.
- [ ] Implement `useRoomStatusPolling(roomId, status, loadRoom)` — set up `setInterval` only when status ∈ `{voting_ending, scoring}` with 3 s cadence, and a `visibilitychange` listener for `{voting, voting_ending, scoring, announcing}`. Stable `loadRoom` ref pattern.
- [ ] Tests pass.
- [ ] Wire into `page.tsx`: `useRoomStatusPolling(roomId, phase.kind === "ready" ? phase.room.status : null, loadRoom);`.
- [ ] Commit.

---

## Fix 6 — Host CTA to open TV mode after End Voting + live mode

**Why:** When the host ends voting on a `live` room, they land on the `scoring` screen briefly and then `<AnnouncingView>` for everyone — there's no surfaced action to launch `/room/[id]/present` on the TV. The lobby has an "Open on TV" link but the host has long left it by then.

**Files:**
- Modify: `src/components/room/ScoringScreen.tsx` — when `isAdmin && announcementMode === "live"`, render an "Open on TV" CTA + 2-bullet guidance + "Copy TV link" button.
- Modify: `src/components/room/AnnouncingView.tsx` — in owner-watching mode (no delegate, not active driver), render a small "Open on TV" pill above the leaderboard.
- Modify: `src/locales/{en,es,uk,fr,de}.json` — add `tvMode.title`, `.bullet1`, `.bullet2`, `.openButton`, `.copyButton`, `.copyConfirm`, `.pillLabel`.
- Test: `src/components/room/ScoringScreen.test.tsx` — extend / create.
- Test: extend `src/components/room/AnnouncingView.test.tsx` for the pill.

**Steps:**

- [ ] Add `tvMode.*` keys to `en.json` first (everything else falls back to `en`). Then mirror copy in `es`/`uk`/`fr`/`de`.
- [ ] Write the failing RTL test on `ScoringScreen`: when `isAdmin=true`, `announcementMode="live"`, the "Open TV mode" link points at `/room/{id}/present` with `target="_blank"`; clicking "Copy TV link" calls `navigator.clipboard.writeText` with the absolute URL. When `isAdmin=false`, the CTA is suppressed.
- [ ] Confirm failure.
- [ ] Extend `ScoringScreen` props (`roomId`, `isAdmin`, `announcementMode`). Render the new section conditionally.
- [ ] Update `page.tsx` to pass the new props to `<ScoringScreen>`.
- [ ] Write the failing RTL test on `AnnouncingView` owner-watching mode for the pill.
- [ ] Implement the pill inside `AnnouncingView`.
- [ ] Tests pass.
- [ ] Commit.

---

## Fix 3 — Overall winner card opens the awards ceremony

**Why:** SPEC §11.3 reveals category awards first, then personality awards ending with "The enabler". Users found the lack of an explicit "And the winner is…" moment confusing — the leaderboard ceremony shows the winner implicitly via rank, but there's no dedicated card. Add a synthetic ceremony card at index 0 anchored to the highest-points contestant.

**Files:**
- Modify: `src/lib/awards/awardCeremonySequence.ts` — accept `leaderboard?: LeaderboardEntry[]`; if non-empty, prepend an `"overall-winner"` card with the rank-1 contestant.
- Modify: `src/components/awards/AwardCeremonyCard.tsx` — render the new `kind: "overall-winner"` (contestant-style layout, distinct title + caption from locale keys).
- Modify: `src/components/room/DoneCeremony.tsx` — pass `data.leaderboard` into the sequence builder.
- Modify: `src/locales/*.json` — add `awards.overall_winner.{name,caption}` to all 5 locales.
- Test: `src/lib/awards/awardCeremonySequence.test.ts` — extend with a new case: with non-empty leaderboard the first card is `overall-winner` and references rank-1 contestant. With empty leaderboard no such card.
- Test: extend `src/components/awards/AwardCeremonyCard.test.tsx` with a render assertion for the new kind.

**Steps:**

- [ ] Add locale keys.
- [ ] Write failing test for `awardCeremonySequence` overall-winner prepending.
- [ ] Implement option `{leaderboard?: LeaderboardEntry[], contestants}` → prepend `{kind: "overall-winner", contestant, totalPoints, award: {awardKey: "overall_winner", awardName, ...}}`.
- [ ] Write failing test for `AwardCeremonyCard` overall-winner rendering: shows flag, country, "And the winner is…" header, points stat.
- [ ] Implement the render branch using `t("awards.overall_winner.name")` and `t("awards.overall_winner.caption")`.
- [ ] Wire `DoneCeremony` to pass leaderboard.
- [ ] Tests pass.
- [ ] Commit.

---

## Fix 4 — Translate hardcoded awards strings

**Why:** [AwardCeremonyCard.tsx:25,44,93](src/components/awards/AwardCeremonyCard.tsx#L25-L93) renders `card.award.awardName` directly. `room_awards.award_name` is a server-side English literal. Same for `card.award.statLabel`. [awardExplainers.ts](src/lib/awards/awardExplainers.ts) is hardcoded English. The locale files already include `awards.personality.<key>.{name,stat}` + `awards.explainers.<key>` in all 5 languages — the component just doesn't use them.

**Files:**
- Modify: `src/components/awards/AwardCeremonyCard.tsx` — derive the displayed name / stat / explainer via `t()` keyed by `card.award.awardKey`, falling back to `card.award.awardName` / `statLabel` for unknown keys (e.g. custom-category `best_<slug>` awards keep the user-typed category name).
- Modify: `src/locales/*.json` — add a `awards.bestCategory` ICU template (`"Best {categoryName}"`) plus translations for the category-award stat suffix `awards.bestCategoryStat` (`"avg {value}/10"`).
- Modify: `src/lib/awards/awardCeremonySequence.ts` (or downstream) — for category awards, expose the category display name on the card so the component can render `t("awards.bestCategory", { categoryName })`.
- Test: extend `AwardCeremonyCard.test.tsx` — assert the personality award `biggest_stan` renders the localized name + stat (mock `useTranslations` map per repo convention).

**Steps:**

- [ ] Inventory: enumerate every static English string still rendered in `AwardCeremonyCard.tsx` (already listed above) and `EndOfShowCtas.tsx`. Confirm `AwardsCeremony.tsx` is already `t()`-driven.
- [ ] Add `awards.bestCategory` + `awards.your_neighbour.youAnd` (replaces the hardcoded `"You & "`) + `awards.jointSeparator` (replaces hardcoded `" & "`) to all 5 locale files.
- [ ] Write failing tests: render with `awardKey: "biggest_stan"` and an English `awardName`/`statLabel` from the server; assert the LOCALIZED `awards.personality.biggest_stan.name` is shown, not the server string. Render with `awardKey: "best_vocals"` and category name `"Vocals"`; assert `t("awards.bestCategory", { categoryName: "Vocals" })` is shown.
- [ ] Refactor `AwardCeremonyCard` to use `t()`-derived strings with safe fallback to the server-supplied values.
- [ ] Re-check `EndOfShowCtas` and other awards components for any straggling English literals.
- [ ] Tests pass; `npm run type-check` clean.
- [ ] Commit.

---

## Playwright coverage

**Files:**
- Create: `tests/e2e/end-voting-cta-position.spec.ts` — host on the voting page sees End Voting button BELOW the nav footer; locale switcher + theme toggle never overlap.
- Create: `tests/e2e/tv-mode-cta.spec.ts` — host on the scoring screen with `announcementMode: "live"` sees the Open-TV CTA and `target="_blank"`.

**Steps:**

- [ ] Write a fixture for the scoring + voting room states (reuse existing fixtures where possible). Stub `/api/rooms/{id}` and `/api/results/{id}` like the existing awards-ceremony spec.
- [ ] Author both specs; assert the targeted DOM positions.
- [ ] Run `npm run test:e2e` headless. Iterate.
- [ ] Commit.

---

## Verification gate

Before declaring done:
1. `npm run type-check` — clean.
2. `npm run test` — all green.
3. `npm run test:e2e` — both new specs + the existing suite green.
4. `npm run lint` — clean (or only pre-existing warnings; do not introduce new ones).
5. Smoke `npm run dev` and walk Fix 1 + Fix 6 manually since those are the most visible.

Commit cadence: one commit per fix (six commits) plus one commit for the Playwright specs. Push to `fix/host-ui-batch-2026-05-14` and open a PR against `main`.
