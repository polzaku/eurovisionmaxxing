/**
 * Pure helpers for `scripts/fetch-contestants.ts`. Everything here is
 * deterministic and I/O-free — the CLI entry handles fetch/file I/O and
 * delegates parsing, validation, and merging to these functions.
 *
 * Maintainers run `npm run fetch-contestants <year> <event>` after a
 * Eurovision allocation draw (SPEC §5.1c) to populate
 * `data/contestants/{year}/{event}.json`. The script preserves
 * operator-curated fields (`broadcastStartUtc`, per-row `artistPreviewUrl`)
 * across runs — the upstream API only provides the canonical 4 fields.
 */

export type EventArg = "semi1" | "semi2" | "final";

export interface ApiRow {
  country: string;
  artist: string;
  song: string;
  runningOrder: number;
}

export interface WrapperRow extends ApiRow {
  artistPreviewUrl?: string;
}

export interface WrapperJson {
  broadcastStartUtc?: string;
  contestants: WrapperRow[];
}

/** Map internal event slug → EurovisionAPI path segment. */
export function eventToApiPath(event: EventArg): string {
  switch (event) {
    case "semi1":
      return "first-semi-final";
    case "semi2":
      return "second-semi-final";
    case "final":
      return "grand-final";
  }
}

export function parseEventArg(raw: string): EventArg | null {
  if (raw === "semi1" || raw === "semi2" || raw === "final") return raw;
  return null;
}

export function parseYearArg(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw) return null;
  if (n < 1956 || n > 9999) return null;
  return n;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Validate the upstream response shape. Returns the canonical 4-field rows
 * on success; a list of validation problems on failure (1+).
 */
export function validateApiBody(
  body: unknown,
): { ok: true; rows: ApiRow[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(body)) {
    return { ok: false, errors: [`expected JSON array, got ${typeof body}`] };
  }
  if (body.length === 0) {
    return {
      ok: false,
      errors: [
        "upstream returned an empty array — likely the allocation draw " +
          "for this event has not happened yet (SPEC §5.3)",
      ],
    };
  }
  const errors: string[] = [];
  const rows: ApiRow[] = [];
  for (let i = 0; i < body.length; i++) {
    const r = body[i] as Record<string, unknown>;
    if (
      !isNonEmptyString(r.country) ||
      !isNonEmptyString(r.artist) ||
      !isNonEmptyString(r.song) ||
      typeof r.runningOrder !== "number"
    ) {
      errors.push(
        `row ${i}: missing or wrong-typed required field (country, artist, song, runningOrder)`,
      );
      continue;
    }
    rows.push({
      country: r.country,
      artist: r.artist,
      song: r.song,
      runningOrder: r.runningOrder,
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}

/**
 * Parse an existing wrapper or legacy-array JSON file. Returns null for
 * malformed input — the caller treats that as "no preserved data" and
 * overwrites without merging (with a warning).
 */
export function parseExistingJson(raw: string): WrapperJson | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Legacy flat-array shape — convert to wrapper with no broadcast time.
  if (Array.isArray(parsed)) {
    const contestants: WrapperRow[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (
        !isNonEmptyString(r.country) ||
        !isNonEmptyString(r.artist) ||
        !isNonEmptyString(r.song) ||
        typeof r.runningOrder !== "number"
      ) {
        continue;
      }
      const out: WrapperRow = {
        country: r.country,
        artist: r.artist,
        song: r.song,
        runningOrder: r.runningOrder,
      };
      if (isNonEmptyString(r.artistPreviewUrl)) {
        out.artistPreviewUrl = r.artistPreviewUrl;
      }
      contestants.push(out);
    }
    return { contestants };
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const inner = obj.contestants;
  if (!Array.isArray(inner)) return null;

  const contestants: WrapperRow[] = [];
  for (const row of inner) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (
      !isNonEmptyString(r.country) ||
      !isNonEmptyString(r.artist) ||
      !isNonEmptyString(r.song) ||
      typeof r.runningOrder !== "number"
    ) {
      continue;
    }
    const out: WrapperRow = {
      country: r.country,
      artist: r.artist,
      song: r.song,
      runningOrder: r.runningOrder,
    };
    if (isNonEmptyString(r.artistPreviewUrl)) {
      out.artistPreviewUrl = r.artistPreviewUrl;
    }
    contestants.push(out);
  }
  const wrapper: WrapperJson = { contestants };
  if (isNonEmptyString(obj.broadcastStartUtc)) {
    wrapper.broadcastStartUtc = obj.broadcastStartUtc;
  }
  return wrapper;
}

/**
 * Merge fresh upstream rows with operator-curated fields from the existing
 * file:
 *   - top-level `broadcastStartUtc` (operator-set per §6.6.1)
 *   - per-row `artistPreviewUrl` (operator-set per §6.6.3), keyed by
 *     country name (case-insensitive)
 *
 * Returns the wrapper-shape JSON ready to write. Sorts contestants by
 * runningOrder ascending so the output is diff-stable across runs.
 */
export function mergeWithExisting(
  upstream: ApiRow[],
  existing: WrapperJson | null,
): WrapperJson {
  const previewByCountry = new Map<string, string>();
  if (existing) {
    for (const row of existing.contestants) {
      if (row.artistPreviewUrl !== undefined) {
        previewByCountry.set(row.country.toLowerCase(), row.artistPreviewUrl);
      }
    }
  }
  const sorted = [...upstream].sort((a, b) => a.runningOrder - b.runningOrder);
  const contestants: WrapperRow[] = sorted.map((r) => {
    const out: WrapperRow = {
      country: r.country,
      artist: r.artist,
      song: r.song,
      runningOrder: r.runningOrder,
    };
    const preserved = previewByCountry.get(r.country.toLowerCase());
    if (preserved !== undefined) {
      out.artistPreviewUrl = preserved;
    }
    return out;
  });
  const wrapper: WrapperJson = { contestants };
  if (existing?.broadcastStartUtc !== undefined) {
    wrapper.broadcastStartUtc = existing.broadcastStartUtc;
  }
  return wrapper;
}

/** Count of rows whose preserved `artistPreviewUrl` survived the merge. */
export function countPreservedPreviews(wrapper: WrapperJson): number {
  let n = 0;
  for (const row of wrapper.contestants) {
    if (row.artistPreviewUrl !== undefined) n++;
  }
  return n;
}
