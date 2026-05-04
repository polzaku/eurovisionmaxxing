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

## Implemented states

| State | Status | What it lands you on |
|---|---|---|
| `lobby-with-3-guests` | ✅ implemented | A `status=lobby` room with the owner + 3 guests already joined. Test the lobby UI, edit-categories, edit-mode, "Start voting", roster behaviour. |
| `voting-half-done` | 🚧 stub | (see "Adding states" below) |
| `voting-ending-mid-countdown` | 🚧 stub | |
| `announcing-mid-queue-live` | 🚧 stub | |
| `announcing-instant-all-ready` | 🚧 stub | |
| `done-with-awards` | ✅ implemented | A `status=done` room with 4 users, votes on every contestant, results rows, and 2 demo awards. Test `<DoneCeremony>` + the post-awards CTA footer + `/results/{id}` static page. |

The two implemented states cover the highest-ROI dry-run scenarios: the entry surface (lobby) and the post-show reveal flow (done). The other four are scoped in SPEC §17a.6 and listed as stubs that bail with a helpful message — extending them is a follow-up PR.

## Safety gates

The seeder + cleanup script both:

1. Refuse to run when `NODE_ENV === "production"` unless `--allow-prod` is passed explicitly.
2. Use the test-fixture year `9999`, which `isTestFixtureYear()` (in `src/lib/contestants.ts`) restricts to non-prod environments.
3. Tag every seeded room with the `SEED` PIN prefix (`SEED??` 6-char PINs from the standard PIN_CHARSET).
4. Tag every seeded user's display name with the `Seed ` prefix (`Seed Alice`, `Seed Bob`, …).

The cleanup script wipes by PIN prefix on `rooms` first, cascades through `room_memberships` / `votes` / `results` / `room_awards`, then deletes seeded users **only if they no longer have any membership row anywhere** — defends against accidentally deleting a real user named "Seed Foo".

## Adding states

Each state is an `async function (db: Db) => Promise<SeedReport>` in `seed-room.ts`. Wire it into `STATE_BUILDERS` and `SEED_STATES`. The pattern (per the implemented examples):

1. Insert seeded users via `insertSeededUser(db, idx)` — idx 0 is the owner.
2. Insert the room via `insertSeededRoom(db, ownerUserId, overrides)` — overrides set status, voting timestamps, announcement_mode, etc.
3. Insert memberships for every user.
4. Insert votes / results / awards as needed for the target state.
5. Return a `SeedReport` with the URL, owner session, and any operator notes.

The pure data builders (`buildFullScores`, `buildHalfScores`, `buildSeedDisplayName`, etc.) live in `seed-helpers.ts` and are unit-tested in `seed-helpers.test.ts`.

## Why no automatic cleanup-on-fail

The seeder doesn't roll back partial inserts — if `insertSeededRoom` succeeds but a downstream membership insert fails, you get an orphan row. Run `npm run seed:cleanup` to wipe and retry. Building proper transactional inserts would require Postgres RPC functions, which is out of scope for the dry-run accelerator this script is meant to be.
