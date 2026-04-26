# Test contest fixture (year `9999`)

A small fixture used **for development and manual QA only** so smoke tests through `/create → vote → score → results` are quick.

- **5 contestants** for `final` (Sweden / Ukraine / Italy / France / UK).
- 3 + 2 contestants for `semi1` / `semi2` to keep the cascade working.
- Real country names so the existing `COUNTRY_CODES` map produces correct flags.
- Artists/songs are obviously placeholder to make it visually distinct from real-year data.

## Production safety

`fetchContestants` and `fetchContestantsMeta` refuse to load this fixture when `process.env.NODE_ENV === "production"` — see `src/lib/contestants.ts::TEST_FIXTURE_YEAR` and the `isTestFixtureYear` guard. The room-creation route also rejects `year: 9999` outside dev (`src/lib/rooms/create.ts`). Defense in depth — both the data layer and the validation layer block prod access.

The Create wizard's year dropdown only includes `9999` when `process.env.NODE_ENV !== "production"`, so guests on the deployed site never see the option.

## Using it

1. Run `npm run dev`.
2. Visit `/create`. The year dropdown lists `9999 (test)` at the top.
3. Pick `9999` + `Grand Final` → 5 contestants load.
4. Continue through voting + scoring as normal.
