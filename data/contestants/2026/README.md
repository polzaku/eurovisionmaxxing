# 2026 contestant data — pre-show status

**As of 2026-05-04** (12 days before the Grand Final on 2026-05-16):

| File | Status | Source |
|---|---|---|
| `semi1.json` | ✅ populated (17 entries, full running order) | eurovisionworld.com — Semi-Final 1 running order, drawn before this date |
| `semi2.json` | ✅ populated (18 entries, full running order) | eurovisionworld.com — Semi-Final 2 running order, drawn before this date |
| `final.json` | 🚧 **EMPTY — must be populated by 2026-05-14 evening** | Grand Final running order isn't drawn until after both semis conclude |

## Operator action — 2026-05-14 evening

Once Semi-Final 2 wraps (approx 22:30 UTC on 2026-05-14), the EBU draws the Grand Final running order from the 25 qualified countries (10 from each semi + 5 Big-5 + host = 26 maximum, with one qualifier sometimes withdrawing). Within ~30 minutes of SF2 ending, the running order is published on eurovisionworld.com and Wikipedia.

**Action:** populate `data/contestants/2026/final.json` with the full lineup before midnight UTC on 2026-05-14, then commit and deploy.

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
