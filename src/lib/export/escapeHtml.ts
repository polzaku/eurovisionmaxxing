/**
 * HTML-escape arbitrary text for safe inclusion in `<body>` content or
 * attribute values. Order matters: `&` must be replaced first so the
 * subsequent ampersand-replacements aren't double-encoded.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
