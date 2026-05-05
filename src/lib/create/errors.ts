const MESSAGES: Record<string, string> = {
  INVALID_YEAR: "That year isn't available. Try a different one.",
  INVALID_EVENT: "That event isn't available for this year.",
  INVALID_CATEGORIES: "Something's off with the category setup.",
  INVALID_CATEGORY: "One of the categories isn't valid.",
  INVALID_ANNOUNCEMENT_MODE: "Pick Live or Instant announcement mode.",
  INVALID_USER_ID: "Your session is invalid. Please re-onboard.",
  INVALID_BODY: "Something went wrong. Please try again.",
  INTERNAL_ERROR: "We hit a snag on our end. Please try again in a moment.",
  NETWORK: "We couldn't reach the server. Check your connection.",
  TIMEOUT: "Loading is taking too long. Try again, or pick a different year/event.",
};

const GENERIC = "Something went wrong. Please try again.";

export function mapCreateError(code: string | undefined): string {
  if (!code) return GENERIC;
  return MESSAGES[code] ?? GENERIC;
}
