#!/usr/bin/env tsx
/**
 * SPEC §5.1c maintainer tool: populate
 * `data/contestants/{year}/{event}.json` from the EurovisionAPI after an
 * allocation draw / withdrawal announcement.
 *
 * Usage:
 *   npm run fetch-contestants <year> <event>
 *
 * Where <event> is one of: semi1 | semi2 | final.
 *
 * Writes wrapper-shape JSON ({ broadcastStartUtc?, contestants: [...] })
 * matching `parseContestantsJson` in `src/lib/contestants.ts` (R2 #241).
 * Preserves two operator-curated fields across runs when the file
 * already exists:
 *   - top-level `broadcastStartUtc` (set manually per §6.6.1 lobby
 *     countdown — API doesn't supply it)
 *   - per-row `artistPreviewUrl` (set manually per §6.6.3 primer carousel —
 *     API doesn't supply it either)
 *
 * Exits 0 on success, non-zero on any failure (network, validation,
 * file write). Per SPEC §5.1c the operator runs this manually, typically
 * within 24h of the allocation draw, so the failure mode is "operator
 * sees the error and re-tries", not "CI catches it".
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  countPreservedPreviews,
  eventToApiPath,
  mergeWithExisting,
  parseEventArg,
  parseExistingJson,
  parseYearArg,
  validateApiBody,
  type EventArg,
} from "./fetch-contestants-helpers";

const EUROVISION_API_BASE = "https://eurovisionapi.runasp.net/api";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = resolve(__dirname, "..", "data", "contestants");

function targetPath(year: number, event: EventArg): string {
  return resolve(DATA_ROOT, String(year), `${event}.json`);
}

function usage(): never {
  console.error("Usage: npm run fetch-contestants <year> <event>");
  console.error("  <year>  4-digit year (e.g. 2026)");
  console.error("  <event> one of: semi1 | semi2 | final");
  process.exit(2);
}

async function main(): Promise<void> {
  const [, , rawYear, rawEvent, ...rest] = process.argv;
  if (!rawYear || !rawEvent || rest.length > 0) usage();
  const year = parseYearArg(rawYear);
  const event = parseEventArg(rawEvent);
  if (year === null) {
    console.error(`Invalid year: "${rawYear}". Expected 4-digit year ≥ 1956.`);
    usage();
  }
  if (event === null) {
    console.error(
      `Invalid event: "${rawEvent}". Expected one of: semi1 | semi2 | final.`,
    );
    usage();
  }

  const apiPath = eventToApiPath(event);
  const url = `${EUROVISION_API_BASE}/contests/${year}/events/${apiPath}/contestants`;
  console.log(`→ Fetching ${url}`);

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(
      `✗ Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  if (res.status !== 200) {
    console.error(
      `✗ Upstream returned HTTP ${res.status} ${res.statusText}. ` +
        `For current-season semis this often means the allocation draw ` +
        `has not happened yet — see SPEC §5.3.`,
    );
    process.exit(1);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    console.error(
      `✗ Response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const validation = validateApiBody(body);
  if (!validation.ok) {
    console.error(`✗ Upstream payload failed validation:`);
    for (const e of validation.errors) console.error(`  • ${e}`);
    process.exit(1);
  }
  console.log(`  ${validation.rows.length} contestants received.`);

  // Load existing file (if any) to preserve operator-curated fields.
  const outPath = targetPath(year, event);
  let existing = null;
  if (existsSync(outPath)) {
    try {
      const raw = readFileSync(outPath, "utf8");
      existing = parseExistingJson(raw);
      if (existing === null) {
        console.warn(
          `  ⚠ Existing file at ${outPath} is unparseable — overwriting ` +
            `without preserving broadcastStartUtc / artistPreviewUrl.`,
        );
      }
    } catch (err) {
      console.warn(
        `  ⚠ Could not read existing file (${err instanceof Error ? err.message : String(err)}); overwriting.`,
      );
    }
  }

  const wrapper = mergeWithExisting(validation.rows, existing);

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(wrapper, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error(
      `✗ Failed to write ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const preservedCount = countPreservedPreviews(wrapper);
  console.log(`✓ Wrote ${outPath}`);
  console.log(
    `  ${wrapper.contestants.length} contestants · ` +
      `broadcastStartUtc: ${wrapper.broadcastStartUtc ?? "(none — set manually for §6.6.1)"} · ` +
      `${preservedCount} artistPreviewUrl preserved`,
  );
}

main().catch((err) => {
  console.error("Unexpected crash:", err);
  process.exit(1);
});
