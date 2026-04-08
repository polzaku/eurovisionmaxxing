# Contestant Data

Hardcoded JSON fallback data for Eurovision contestants.

## File structure

```
data/contestants/{year}/{event}.json
```

Where `event` is one of: `semi1`, `semi2`, `final`.

## Updating

Update these files manually once per season when the lineup confirms.
The app tries the EurovisionAPI first and only falls back to these files
if the API is unavailable or returns invalid data.

## Format

Each file is a JSON array of objects:

```json
{
  "country": "United Kingdom",
  "artist": "Remember Monday",
  "song": "What The Hell Just Happened?",
  "runningOrder": 8
}
```

Note: `countryCode`, `flagEmoji`, and `id` are derived at runtime —
you only need to provide the four fields above.

## 2026

The 2026 files are empty placeholders. Update them when the lineup is announced.
