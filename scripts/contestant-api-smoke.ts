#!/usr/bin/env tsx
/**
 * SPEC §5.5 — daily integration smoke against the live EurovisionAPI.
 *
 * Hits the same URL pattern production uses (`src/lib/contestants.ts`)
 * for the 2025 Grand Final and asserts:
 *
 *   1. HTTP 200
 *   2. JSON-parses cleanly
 *   3. Body is an array of length ≥ 25
 *   4. Every row has the four required fields (country, artist, song,
 *      runningOrder) with the expected types
 *   5. Spot-check: the row with runningOrder=1 matches the committed
 *      `data/contestants/2025/final.json` row at index 0
 *
 * On any assertion failure the script prints a failure summary and
 * exits non-zero. The companion workflow
 * (`.github/workflows/contestant-api-smoke.yml`) catches that and
 * files a GitHub Issue with the `api-upstream` label so the operator
 * can intervene before show night.
 *
 * The smoke does NOT block PRs — the fallback cascade in
 * `loadHardcoded()` exists precisely so upstream flakiness doesn't
 * break us. The job's value is surfacing slow rot in the upstream
 * schema before it bites mid-show.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EUROVISION_API_BASE = "https://eurovisionapi.runasp.net/api";
const TARGET_YEAR = 2025;
const TARGET_EVENT_PATH = "grand-final";
const MIN_CONTESTANTS = 25;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FALLBACK_FIXTURE = resolve(
  __dirname,
  "..",
  "data",
  "contestants",
  `${TARGET_YEAR}`,
  "final.json",
);

interface Failure {
  step: string;
  detail: string;
}

interface UpstreamRow {
  country?: unknown;
  artist?: unknown;
  song?: unknown;
  runningOrder?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

async function smoke(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const url = `${EUROVISION_API_BASE}/contests/${TARGET_YEAR}/events/${TARGET_EVENT_PATH}/contestants`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    failures.push({
      step: "fetch",
      detail: `Network error hitting ${url}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return failures;
  }

  if (res.status !== 200) {
    failures.push({
      step: "http-status",
      detail: `Expected HTTP 200; got ${res.status} ${res.statusText} from ${url}`,
    });
    // Don't bother parsing further; status alone is enough signal.
    return failures;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    // Most likely the host now serves an SPA shell at the API path
    // (i.e. 200 + HTML rather than JSON). That's the failure mode this
    // smoke is built to catch.
    failures.push({
      step: "json-parse",
      detail: `Response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return failures;
  }

  if (!Array.isArray(body)) {
    failures.push({
      step: "shape-array",
      detail: `Expected JSON array; got ${typeof body}`,
    });
    return failures;
  }

  if (body.length < MIN_CONTESTANTS) {
    failures.push({
      step: "min-length",
      detail: `Expected ≥ ${MIN_CONTESTANTS} contestants; got ${body.length}`,
    });
  }

  // Every row must have the four required fields.
  const malformed: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const row = body[i] as UpstreamRow;
    if (
      !isNonEmptyString(row.country) ||
      !isNonEmptyString(row.artist) ||
      !isNonEmptyString(row.song) ||
      typeof row.runningOrder !== "number"
    ) {
      malformed.push(i);
    }
  }
  if (malformed.length > 0) {
    failures.push({
      step: "row-shape",
      detail: `Rows at indices [${malformed.slice(0, 5).join(", ")}${malformed.length > 5 ? "…" : ""}] are missing one of {country, artist, song, runningOrder} or have wrong types (total: ${malformed.length})`,
    });
  }

  // Spot-check: runningOrder=1 should match the committed fallback's
  // row at index 0 (which is the canonical Eurovision 2025 SF/F first
  // performer per the EBU broadcast). If they drift, either upstream
  // re-ordered or our fallback drifted — both worth flagging.
  let fallbackFirst: UpstreamRow;
  try {
    const fallback = JSON.parse(readFileSync(FALLBACK_FIXTURE, "utf8"));
    if (!Array.isArray(fallback) || fallback.length === 0) {
      throw new Error("fallback fixture is empty or not an array");
    }
    fallbackFirst = fallback[0] as UpstreamRow;
  } catch (err) {
    failures.push({
      step: "fallback-load",
      detail: `Could not load fallback fixture for spot-check: ${err instanceof Error ? err.message : String(err)}`,
    });
    return failures;
  }

  const upstreamFirst = (body as UpstreamRow[]).find(
    (r) => r.runningOrder === 1,
  );
  if (!upstreamFirst) {
    failures.push({
      step: "spot-check",
      detail: `No upstream row has runningOrder=1 — can't spot-check against fallback.`,
    });
  } else if (
    isNonEmptyString(upstreamFirst.country) &&
    isNonEmptyString(fallbackFirst.country) &&
    upstreamFirst.country !== fallbackFirst.country
  ) {
    failures.push({
      step: "spot-check",
      detail: `Upstream row at runningOrder=1 is "${upstreamFirst.country}"; fallback index 0 is "${fallbackFirst.country}". One of them drifted — refresh-contestants likely needed.`,
    });
  }

  return failures;
}

async function main(): Promise<void> {
  console.log(
    `Smoke-testing EurovisionAPI for ${TARGET_YEAR}/${TARGET_EVENT_PATH}…`,
  );
  console.log(
    `URL: ${EUROVISION_API_BASE}/contests/${TARGET_YEAR}/events/${TARGET_EVENT_PATH}/contestants`,
  );
  const failures = await smoke();

  if (failures.length === 0) {
    console.log("\n✅ Smoke passed.");
    process.exit(0);
  }

  console.error(`\n❌ ${failures.length} assertion(s) failed:\n`);
  for (const f of failures) {
    console.error(`  • [${f.step}] ${f.detail}`);
  }
  console.error(
    "\nIf this is the first failure, file the api-upstream issue " +
      "(handled automatically by the smoke workflow). If the upstream " +
      "host's URL pattern changed, update EUROVISION_API_BASE in " +
      "src/lib/contestants.ts to match and re-run.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("Smoke crashed:", err);
  process.exit(1);
});
