const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "No room matches that PIN. Check with the host.",
  ROOM_NOT_JOINABLE: "This room isn't accepting new members right now.",
  INVALID_PIN: "That doesn't look like a valid room PIN.",
  INVALID_USER_ID: "Your session is invalid. Please re-onboard.",
};

const GENERIC = "Something went wrong. Please try again.";

export function mapJoinError(code: string | undefined): string {
  if (!code) return GENERIC;
  return MESSAGES[code] ?? GENERIC;
}
