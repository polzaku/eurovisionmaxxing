const ROOM_PATH_RE =
  /^\/room\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export function extractRoomId(nextPath: string): string | null {
  const match = ROOM_PATH_RE.exec(nextPath);
  return match ? match[1] : null;
}
