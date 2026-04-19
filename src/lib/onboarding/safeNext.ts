const MAX_LEN = 512;
const CONTROL_CHAR_RE = /[\x00-\x1F]/;

export function sanitizeNextPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (raw.length === 0 || raw.length > MAX_LEN) return "/";
  if (raw[0] !== "/") return "/";
  if (raw[1] === "/" || raw[1] === "\\") return "/";
  if (CONTROL_CHAR_RE.test(raw)) return "/";
  return raw;
}
