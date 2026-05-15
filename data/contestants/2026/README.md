# 2026 contestant data — pre-show status

**As of 2026-05-15** (1 day before the Grand Final on 2026-05-16):

| File | Status | Source |
|---|---|---|
| `semi1.json` | ✅ populated (17 entries, full running order) | eurovisionworld.com — Semi-Final 1 running order, drawn before 2026-05-04 |
| `semi2.json` | ✅ populated (18 entries, full running order) | eurovisionworld.com — Semi-Final 2 running order, drawn before 2026-05-04 |
| `final.json` | ✅ populated (25 entries, full running order) | eurovision.com — drawn 2026-05-15 02:08 CEST, immediately after SF2 |

## Operator action — completed 2026-05-15

The EBU drew the Grand Final running order in the early hours after SF2 wrapped. The 25-entry lineup (20 qualifiers + Big-4 [Germany / France / UK / Italy] + host Austria — Spain withdrew from the 2026 contest) was published at <https://www.eurovision.com/stories/running-order-eurovision-2026-grand-final-vienna/>. Artist + song values use the same spelling as `semi1.json` / `semi2.json` so the country join in `src/lib/contestants.ts` is consistent across files.

The file shape — same as `2025/final.json` — is a JSON array of objects:

```jsonc
[
  { "country": "Sweden", "artist": "Felicia", "song": "My System", "runningOrder": 1 },
  // … one entry per finalist, sorted by runningOrder
]
```

Four fields only — `country`, `artist`, `song`, `runningOrder`. Everything else (id, countryCode, flagEmoji) is derived at runtime by `src/lib/contestants.ts`. Country names must match the `COUNTRY_CODES` map in that file or fall back to a 2-letter slice of the country name (which is wrong for some countries — extend the map if a new debut country lands).

## Why semi files are populated but final is empty

The fallback is load-bearing — it's what every room renders when the upstream API is unreachable. We populate it eagerly for surfaces where data is already public.

The fallback is also what triggers a **loud, room-creation-blocking error** when missing — see `loadHardcoded()` in `src/lib/contestants.ts`. We deliberately leave `final.json` at `[]` to make sure room creation fails noisily on the night, rather than silently rendering a stub-shaped lineup. Better to fail-loud and force the operator action than to ship a half-fix that nobody notices.

## Upstream API caveat

The `EUROVISION_API_BASE` constant in `src/lib/contestants.ts` (= `https://eurovisionapi.runasp.net/api`) returns 404 from every probe as of 2026-05-04. Production silently falls through to these hardcoded files. Until the upstream is fixed (or rebased onto the [EurovisionAPI/dataset](https://github.com/EurovisionAPI/dataset) GitHub repo, which has a different shape and only goes up to 2025), assume the cascade is **fallback-only** and treat these files as the source of truth.
