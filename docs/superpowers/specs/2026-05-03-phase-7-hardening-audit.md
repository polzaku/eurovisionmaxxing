# Phase 7 — Hardening + Deploy Checklist

**Audit date:** 2026-05-03
**Ship deadline:** 2026-05-14
**Eurovision Grand Final:** 2026-05-16

This doc closes out the code-side of Phase 7 and hands the deploy/ops items to the human. Use it as the deploy-day reference.

---

## 1. Input validation audit ✅ PASS

22 API routes scanned (`src/app/api/**/route.ts`). Outcome: **20 strict pass, 2 documented exceptions, zero gaps to fix.**

### Strict pass (20/22)

Every route below: parses `await request.json()` inside a try/catch (when it has a body), guards `body !== null && typeof === 'object'` before destructuring, delegates to an orchestrator that validates `roomId`/`userId`/`contestantId`/etc. with explicit type + UUID-regex + length checks, and returns errors via `apiError()` from `src/lib/api-errors.ts` (preserving the i18n error-toast contract).

- `/api/auth/onboard` · `/api/auth/rejoin` · `/api/auth/candidates` · `/api/auth/claim`
- `/api/results/[id]` · `/api/rooms` · `/api/rooms/[id]` · `/api/rooms/[id]/results`
- `/api/rooms/[id]/status` · `/api/rooms/[id]/now-performing`
- `/api/rooms/[id]/score` · `/api/rooms/[id]/votes`
- `/api/rooms/[id]/announce/next` · `/api/rooms/[id]/announce/handoff` · `/api/rooms/[id]/announce/skip`
- `/api/rooms/[id]/join` · `/api/rooms/join-by-pin`
- `/api/rooms/[id]/own-points` · `/api/rooms/[id]/ready`
- `/api/rooms/[id]/refresh-contestants`

### Documented exceptions (2/22) — kept as-is

- **`/api/health`** — returns `{ ok: false, error: <string> }` with HTTP 503 on failure rather than the structured `apiError()` shape. **Intentional**: SPEC §12.1 lines 1131–1132 documents this as the contract UptimeRobot pings against. Changing it would break monitoring.
- **`/api/contestants`** — returns `{ error: <string> }` rather than the structured shape. **Intentional**: this route is internal-only, called solely by the create wizard via `fetchContestantsPreview` (`src/lib/create/api.ts:48-49`), which has an explicit comment documenting the legacy shape and maps `404 → CONTEST_DATA_NOT_FOUND` to surface the §6.1 Step 1 inline error. Errors here never hit the user-facing toast pipeline. Restandardising it would be ~3 surfaces of churn for zero user-visible improvement.

---

## 2. Admin-only route authorisation audit ✅ PASS

Every admin-mutating orchestrator verified to compare `room.owner_user_id` against the caller's `userId` and return `FORBIDDEN` 403 on mismatch. All paths covered by an RTL or unit test asserting the 403 case.

| Orchestrator | Owner check | Test |
|---|---|---|
| `updateStatus.ts:102` | `row.owner_user_id !== userId` → `FORBIDDEN` 403 | `updateStatus.test.ts:218` |
| `updateNowPerforming.ts:91` | same | `updateNowPerforming.test.ts:245` |
| `runScoring.ts:140` | same | `runScoring.test.ts:371` |
| `setDelegate.ts:111` | same | `setDelegate.test.ts:119` |
| `skipAnnouncer.ts:137` | same | `skipAnnouncer.test.ts:204` |
| `refreshContestants.ts:102` | same | `refreshContestants.test.ts:118` |
| `advanceAnnouncement.ts:157` | multi-role: `announcer ∥ delegate ∥ owner` | `advanceAnnouncement.test.ts:234` |

The multi-role check on `advanceAnnouncement` is intentional — the live-mode announcer advance accepts the active announcer, an admin delegate, or the owner. This is correct per SPEC §10.2 step 7 and §10.2.1.

**Co-admin authorisation is V1.1 only.** Until R1 ships, "admin" is strictly the owner. CLAUDE.md §3.1 codifies this.

---

## 3. End-to-end smoke checklist (manual, pre-deploy)

Run on a real Vercel preview build with at least 3 browsers on different devices (one phone + two laptops minimum). Cover both announcement modes, both happy paths and 1-2 known-tricky edges. Each ✅/❌ is a separate observation.

### Lobby → voting

- [ ] Admin creates a room via the 2-step wizard. PIN/QR/share link visible immediately on the lobby (Step 3 was dropped per T1 — no extra tap).
- [ ] Two guests join via PIN; their avatars appear in the roster within 2 s of joining (`user_joined` broadcast).
- [ ] Admin clicks "Refresh contestants" — status line shows "Already up to date" if nothing changed; button disables for 30 s after success.
- [ ] Admin starts voting. All three clients transition to the voting screen within 2 s (`status_changed`).

### Voting

- [ ] All three clients independently score a few contestants. Saving chip cycles Saving… → Saved.
- [ ] Toggle one contestant to "Missed" on a guest device → 5-second toast with Undo → tap Undo within 5 s → state reverts.
- [ ] Hot-take: type 130 chars → counter turns pink at 130 (within 10 of 140); save persists across reload.
- [ ] One guest goes airplane-mode → SaveChip flips to Offline → bring back online → DrainNotice fires once when queue drains.
- [ ] Admin opens jump-to drawer; rows show ✓/— per local state.
- [ ] Reload a guest's tab mid-voting → score state rehydrates from server, current contestant index restores.

### End of voting

- [ ] On the last contestant, `<EndOfVotingCard>` appears only when the gating conditions hit (T2: self done, OR ≥½ room done, OR all done).
- [ ] Admin taps End voting → modal opens (not `confirm()`) → confirm → 5-s countdown toast with Undo → undo works pre-deadline.
- [ ] Reload admin tab past the deadline → `runScoring` fires automatically (stale-reload recovery).

### Scoring + announcement (live mode)

- [ ] After scoring transition, every client lands on `<AnnouncingView>`.
- [ ] First user is the announcer; admin sees "Announce for {name}" CTA.
- [ ] Reveal next point — points appear with rank-shift animation on guest leaderboards.
- [ ] When an announcer is absent: admin taps "Skip {name} — they're not here" → flow advances → everyone sees `announce_skip`.
- [ ] All users finish → leaderboard ceremony → awards ceremony → 3-CTA footer with Copy link / Copy summary working (2-s "Copied!" confirmation), admin sees Create another room.

### Scoring + announcement (instant mode)

- [ ] Each user sees own-points reveal flow; group leaderboard locked until reveal.
- [ ] "I'm done — let the host know" copy on the Ready button (T3).
- [ ] Admin sees three CTAs progressively unlocking: Reveal final results (when all ready), Reveal anyway (countdown microcopy → enabled at 60 s or ≥½ ready), Admin override (always enabled, with confirm modal).
- [ ] Tap Admin override → confirm → leaderboard ceremony → awards ceremony → CTAs.

### Locale smoke

- [ ] Set browser `Accept-Language: es-AR,es,en` → middleware sets `NEXT_LOCALE` cookie. (Translations beyond `en` are stubbed so most copy stays English; the goal is to confirm no English-flash on SSR and no console errors from missing keys.)

### Reduced motion

- [ ] On a tab with `prefers-reduced-motion: reduce` → leaderboard ceremony snaps without staggered reveal; awards cards render without fade-in; voting score-pop / shimmer / rank-shift suppressed (gated in `globals.css:158-162`).

### Wake lock

- [ ] On a guest device on the voting screen, leave the tab focused for 60 s → screen does not dim. Return to home, lock the device, return after 30 s → screen wake lock re-acquires on visibility change (`useWakeLock`).

### Cross-browser realtime

- [ ] Voting + announcement flows tested on Safari iOS + Chrome Android + Chrome desktop minimum. (The known-fragile bit is Supabase realtime over WebSocket on iOS Safari with the screen locked — verify the `status_changed` and `member_ready` broadcasts re-deliver after a screen-off/screen-on cycle.)

---

## 4. Deploy checklist (operator action — human runs these)

These are intentionally not automated. Do them in order.

### Vercel

1. Connect the GitHub repo to a new Vercel project (via the dashboard).
2. Set environment variables in **Production**, **Preview**, and **Development** environments:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable, can ship to browser)
   - `SUPABASE_SERVICE_ROLE_KEY` (secret, server-only — NEVER expose)
   - `NEXT_PUBLIC_APP_URL` (set to the final domain, e.g. `https://eurovisionmaxxing.com`)
3. Deploy a preview build off `main`. Run the §3 smoke checklist on it.
4. Promote to production once smoke is green.

### Domain

1. In Vercel project → Domains, add `eurovisionmaxxing.com` and `www.eurovisionmaxxing.com`.
2. In Cloudflare (or whichever registrar):
   - Set `eurovisionmaxxing.com` apex `A` record to Vercel's IP (`76.76.21.21`) — Cloudflare proxy **off** (DNS only).
   - Set `www` `CNAME` to `cname.vercel-dns.com` — proxy **off**.
3. Verify SSL provisions automatically. If Cloudflare is in proxy mode, SSL handshake fails — keep proxy off.

### Monitoring

1. Sign up at uptimerobot.com (free tier).
2. Create a "HTTP(s)" monitor pointed at `https://eurovisionmaxxing.com/api/health` on a 5-minute interval.
3. Configure alert contacts (email is fine for MVP).
4. The `/api/health` endpoint runs `supabase.from('rooms').select('id').limit(1)` so a successful 200 means both Vercel and Supabase are reachable. A 503 with `{ ok: false, error }` means Supabase is the failure surface.

### Operational runbook

Already shipped: `SUPABASE_SETUP.md` covers schema migrations + the contestant-data refresh runbook (commit `b6e493d`, 2026-05-02). Re-read it before show night. Open question §19 — name the on-call backup before first show.

---

## 5. What's intentionally NOT in scope

- **`/api/contestants` standardisation** — explained in §1.
- **Co-admin authorisation** — V1.1 with R1.
- **Server-side rate limiting on `/refresh-contestants`** — V1.1 (UI cooldown is the MVP backstop).
- **Multi-window admin-reveal Playwright spec** — the awards-ceremony spec from PR #57 covers a single-session smoke; full cross-window is its own future slice.
- **GitHub Actions CI (`ci.yml`) + contestant-API daily smoke** — V1.1 (R6 sub-items §5.5 + §17a.4).
- **Awards reveal locale beyond `en`** — Phase L L3.

---

## 6. Sign-off criteria

This phase is complete when:

- [x] Code audit (§1 + §2) passes — **done 2026-05-03**.
- [ ] Manual smoke (§3) passes on a Vercel preview build with 3+ devices.
- [ ] Production deploy live at `eurovisionmaxxing.com`.
- [ ] UptimeRobot monitor reporting `200 OK` on `/api/health`.
- [ ] On-call backup name committed to `SUPABASE_SETUP.md`.

The first item is closed by this doc. The remaining four are operator actions and don't block any further code work.
