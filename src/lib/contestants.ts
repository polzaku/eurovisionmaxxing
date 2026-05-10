import type { Contestant, EventType } from "@/types";

const EUROVISION_API_BASE = "https://eurovisionapi.runasp.net/api";

/**
 * Year reserved for the dev-only test fixture (5 contestants, fast smoke
 * cycle through /create → vote → score → results). The fixture lives at
 * `data/contestants/9999/{event}.json`. See `data/contestants/9999/README.md`.
 *
 * `isTestFixtureYear` returns true only outside production — never load this
 * fixture on the deployed site.
 */
export const TEST_FIXTURE_YEAR = 9999;

export function isTestFixtureYear(year: number): boolean {
  return (
    year === TEST_FIXTURE_YEAR && process.env.NODE_ENV !== "production"
  );
}

interface ApiContestant {
  country: string;
  artist: string;
  song: string;
  runningOrder: number;
  [key: string]: unknown;
}

/**
 * Country name → ISO 3166-1 alpha-2 code (lowercase).
 * Extend as needed for Eurovision countries.
 */
const COUNTRY_CODES: Record<string, string> = {
  "Albania": "al", "Armenia": "am", "Australia": "au", "Austria": "at",
  "Azerbaijan": "az", "Belgium": "be", "Bulgaria": "bg", "Croatia": "hr",
  "Cyprus": "cy", "Czech Republic": "cz", "Czechia": "cz",
  "Denmark": "dk", "Estonia": "ee", "Finland": "fi", "France": "fr",
  "Georgia": "ge", "Germany": "de", "Greece": "gr", "Iceland": "is",
  "Ireland": "ie", "Israel": "il", "Italy": "it", "Latvia": "lv",
  "Lithuania": "lt", "Luxembourg": "lu", "Malta": "mt", "Moldova": "md",
  "Montenegro": "me", "Netherlands": "nl", "North Macedonia": "mk",
  "Norway": "no", "Poland": "pl", "Portugal": "pt", "Romania": "ro",
  "San Marino": "sm", "Serbia": "rs", "Slovenia": "si", "Spain": "es",
  "Sweden": "se", "Switzerland": "ch", "Ukraine": "ua",
  "United Kingdom": "gb",
};

function countryCodeToFlagEmoji(code: string): string {
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

function getCountryCode(country: string): string {
  return COUNTRY_CODES[country] ?? country.substring(0, 2).toLowerCase();
}

function isApiContestant(item: unknown): item is ApiContestant {
  if (typeof item !== "object" || item === null) return false;
  const c = item as Record<string, unknown>;
  return (
    typeof c.country === "string" &&
    typeof c.artist === "string" &&
    typeof c.song === "string" &&
    typeof c.runningOrder === "number"
  );
}

/**
 * Parse contestants JSON in either legacy (flat array) or wrapper shape.
 * Returns null if the input doesn't match either shape.
 */
function parseContestantsJson(data: unknown): ApiContestant[] | null {
  // Legacy: bare array of contestants.
  if (Array.isArray(data)) {
    return data.every(isApiContestant) ? data : null;
  }
  // Wrapper: { broadcastStartUtc?, contestants: [...] }.
  if (typeof data === "object" && data !== null) {
    const wrapper = data as Record<string, unknown>;
    const inner = wrapper.contestants;
    if (Array.isArray(inner) && inner.every(isApiContestant)) {
      return inner as ApiContestant[];
    }
  }
  return null;
}

function validateContestants(data: unknown): data is ApiContestant[] {
  return Array.isArray(data) && parseContestantsJson(data) !== null;
}

function mapApiToContestant(
  item: ApiContestant,
  year: number,
  event: EventType
): Contestant {
  const code = getCountryCode(item.country);
  return {
    id: `${year}-${code}`,
    country: item.country,
    countryCode: code,
    flagEmoji: countryCodeToFlagEmoji(code),
    artist: item.artist,
    song: item.song,
    runningOrder: item.runningOrder,
    event,
    year,
  };
}

export interface FetchContestantsOptions {
  /** Skip Next's fetch cache. Used by SPEC §5.1d admin refresh. */
  bypassCache?: boolean;
}

/**
 * Fetch contestant data with the cascade:
 * 1. Try EurovisionAPI
 * 2. Fall back to hardcoded JSON
 * 3. Throw ContestDataError if both fail
 */
export async function fetchContestants(
  year: number,
  event: EventType,
  options: FetchContestantsOptions = {}
): Promise<Contestant[]> {
  // Test-fixture path (dev-only): skip the upstream API and read directly
  // from data/contestants/9999/{event}.json. The guard short-circuits prod.
  if (year === TEST_FIXTURE_YEAR) {
    if (!isTestFixtureYear(year)) {
      throw new ContestDataError(
        `Test fixture year ${year} is not available in this environment.`
      );
    }
    return loadFromHardcoded(year, event);
  }

  // Map event type to API event name
  const eventMap: Record<EventType, string> = {
    semi1: "first-semi-final",
    semi2: "second-semi-final",
    final: "grand-final",
  };

  // Step 1: Try API
  try {
    const url = `${EUROVISION_API_BASE}/contests/${year}/events/${eventMap[event]}/contestants`;
    const res = await fetch(
      url,
      options.bypassCache
        ? { cache: "no-store" }
        : { next: { revalidate: 3600 } },
    );

    if (res.ok) {
      const data = await res.json();
      const parsed = parseContestantsJson(data);
      if (parsed) {
        return parsed
          .map((item) => mapApiToContestant(item, year, event))
          .sort((a, b) => a.runningOrder - b.runningOrder);
      }
    }
    console.warn(`EurovisionAPI returned invalid data for ${year}/${event}`);
  } catch (err) {
    console.warn(`EurovisionAPI fetch failed for ${year}/${event}:`, err);
  }

  // Step 2: Try hardcoded JSON
  try {
    return await loadFromHardcoded(year, event);
  } catch {
    console.warn(`No hardcoded data for ${year}/${event}`);
  }

  // Step 3: Error
  throw new ContestDataError(
    `Contest data not found for ${year} ${event}`
  );
}

/**
 * Load contestants from the bundled JSON. Throws ContestDataError when the
 * file is absent or malformed. Used by the prod fallback path AND the
 * dev-only test-fixture short-circuit.
 */
async function loadFromHardcoded(
  year: number,
  event: EventType
): Promise<Contestant[]> {
  const fallback = await import(`../../data/contestants/${year}/${event}.json`);
  const data = fallback.default ?? fallback;
  const parsed = parseContestantsJson(data);
  if (parsed === null) {
    throw new ContestDataError(`Hardcoded data invalid for ${year} ${event}`);
  }
  return parsed
    .map((item: ApiContestant) => mapApiToContestant(item, year, event))
    .sort((a, b) => a.runningOrder - b.runningOrder);
}

export class ContestDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContestDataError";
  }
}

export interface ContestantsMeta {
  broadcastStartUtc: string | null;
}

/**
 * Reads only the event-level metadata from the hardcoded contestants JSON.
 * Supports both shapes: a bare array (legacy) → `{ broadcastStartUtc: null }`,
 * or `{ broadcastStartUtc?: string, contestants: [...] }` (future, per TODO R2).
 */
export async function fetchContestantsMeta(
  year: number,
  event: EventType,
): Promise<ContestantsMeta> {
  if (year === TEST_FIXTURE_YEAR && !isTestFixtureYear(year)) {
    throw new ContestDataError(
      `Test fixture year ${year} is not available in this environment.`,
    );
  }
  let parsed: unknown;
  try {
    const mod = await import(`../../data/contestants/${year}/${event}.json`);
    parsed = mod.default ?? mod;
  } catch {
    throw new ContestDataError(
      `Contest data not found for ${year} ${event}`,
    );
  }

  if (Array.isArray(parsed)) {
    return { broadcastStartUtc: null };
  }
  if (parsed && typeof parsed === "object") {
    const raw = (parsed as { broadcastStartUtc?: unknown }).broadcastStartUtc;
    return {
      broadcastStartUtc: typeof raw === "string" ? raw : null,
    };
  }
  return { broadcastStartUtc: null };
}
