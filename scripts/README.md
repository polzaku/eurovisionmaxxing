# Seed scripts (SPEC §17a.6)

Dev-only CLI tools that land the operator directly on a target room state, so the Phase 7 manual smoke checklist doesn't have to walk `create → onboard → vote → score → announce → done` on every dry run.

> ⚠️ **Writes to whatever Supabase the env vars point at.** The `.env.local` file in this repo points at the production DB by default. Seeded rooms are tagged with the `SEED` PIN prefix so you can identify and clean them, but if you want true isolation, point `.env.local` at a separate dev project before running.

## Quick start

```bash
# Spin up a lobby room with 3 guests:
npm run seed:room -- lobby-with-3-guests

# Spin up a fully-played-through done room (leaderboard + breakdowns + 2 awards):
npm run seed:room -- done-with-awards

# When you're done, wipe everything tagged with the SEED prefix:
npm run seed:cleanup
```

The seeder prints the room URL, the room PIN, and the owner's session payload. Paste the session JSON into your browser's localStorage as `emx_session` to "be" the owner without going through onboard.

## Implemented states (all 6 scoped in SPEC §17a.6)

| State | What it lands you on |
|---|---|
| `lobby-with-3-guests` | A `status=lobby` room with the owner + 3 guests already joined. Test the lobby UI, edit-categories, edit-mode, "Start voting", roster behaviour. |
| `voting-half-done` | A `status=voting` room with 4 users, half-filled scores on every contestant (only the first ⌈N/2⌉ categories scored). EndOfVotingCard is suppressed until the operator fully scores the last contestant. Tests the mid-vote UI, jump-to drawer, save chip cycle. |
| `voting-ending-mid-countdown` | A `status=voting_ending` room with `voting_ends_at` 30s in the future, half-scored votes. Admin sees `<EndVotingCountdownToast>` with Undo; guests see `<EndingPill>`. Either can let the timer elapse for runScoring. |
| `announcing-mid-queue-live` | A `status=announcing`, `mode=live` room with all results computed. Order is `[owner → guest1 → guest2 → guest3]`. The first user has fully announced; the second user is mid-queue (3 of 5 reveals done); guests 2 + 3 haven't started. Tests the active-driver tap zone, "Up next" panel, /present TV view, owner-watching panel, roster. |
| `announcing-instant-all-ready` | A `status=announcing`, `mode=instant` room. Every member is `is_ready=true` so the admin's "Reveal final results" CTA fires immediately. Operator can also test "Reveal anyway" + always-available admin override. |
| `announcing-cascade-absent` | Live-mode announcing room: 4-user order [A, B, C, D]; A active, B + C absent (last_seen_at 60s ago), D present. Drives the R4 cascade-skip path on next advance. |
| `announcing-cascade-all-absent` | Live-mode announcing room in cascade-exhaust state: 3-user order, all absent (last_seen_at 60s ago), announcing_user_id=null, all in announce_skipped_user_ids, all results.announced=false. Drives the R4 'Finish the show' batch-reveal flow. |
| `done-with-awards` | A `status=done` room with 4 users, votes on every contestant, results rows, and 2 demo awards. Tests `<DoneCeremony>` + the post-awards CTA footer (Copy link · Copy summary · View full results · Create another) + `/results/{id}` static page. |

## Safety gates

The seeder + cleanup script both:

1. Refuse to run when `NODE_ENV === "production"` unless `--allow-prod` is passed explicitly.
2. Use the test-fixture year `9999`, which `isTestFixtureYear()` (in `src/lib/contestants.ts`) restricts to non-prod environments.
3. Tag every seeded room with the `SEED` PIN prefix (`SEED??` 6-char PINs from the standard PIN_CHARSET).
4. Tag every seeded user's display name with the `Seed ` prefix (`Seed Alice`, `Seed Bob`, …).

The cleanup script wipes by PIN prefix on `rooms` first, cascades through `room_memberships` / `votes` / `results` / `room_awards`, then deletes seeded users **only if they no longer have any membership row anywhere** — defends against accidentally deleting a real user named "Seed Foo".

## Adding states

Each state is an `async function (db: Db) => Promise<SeedReport>` in `seed-room.ts`. Wire it into `STATE_BUILDERS` and add the name to `SEED_STATES` in `seed-helpers.ts`. The pattern (per the implemented examples):

1. Insert seeded users via `insertSeededUser(db, idx)` — idx 0 is the owner.
2. Insert the room via `insertSeededRoom(db, ownerUserId, overrides)` — overrides set status, voting timestamps, announcement_mode, etc.
3. Insert memberships for every user (use `isReady=true` for instant-ready states).
4. For post-voting states (announcing / done), call `buildFullVotesAndResults(roomId, users, contestants)` to get vote + result rows. Override per-row fields (`announced=true`, etc.) before insert.
5. For voting-mid-flight states, build votes manually with `buildHalfScores` or a custom helper.
6. Return a `SeedReport` with the URL, owner session, and any operator notes.

The pure data builders (`buildFullScores`, `buildHalfScores`, `buildSeedDisplayName`, etc.) live in `seed-helpers.ts` and are unit-tested in `seed-helpers.test.ts`.

## Why no automatic cleanup-on-fail

The seeder doesn't roll back partial inserts — if `insertSeededRoom` succeeds but a downstream membership insert fails, you get an orphan row. Run `npm run seed:cleanup` to wipe and retry. Building proper transactional inserts would require Postgres RPC functions, which is out of scope for the dry-run accelerator this script is meant to be.
