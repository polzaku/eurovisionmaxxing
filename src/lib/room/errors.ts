const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "This room doesn't exist or has been removed.",
  FORBIDDEN: "Only the host can do that.",
  INVALID_TRANSITION: "That action isn't available right now.",
  INVALID_USER_ID: "Your session is invalid. Please re-onboard.",
  ROOM_NOT_JOINABLE: "This room isn't accepting new members right now.",
  NETWORK: "We couldn't reach the server. Check your connection.",
};

const GENERIC = "Something went wrong. Please try again.";

export function mapRoomError(code: string | undefined): string {
  if (!code) return GENERIC;
  return MESSAGES[code] ?? GENERIC;
}
