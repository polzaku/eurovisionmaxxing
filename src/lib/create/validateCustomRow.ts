/**
 * Per-row validation for the custom template editor.
 *
 * Returns a discriminator code instead of a UI string so the caller can
 * map to translated copy via next-intl. Charset is NOT validated here —
 * the input component itself filters keystrokes against /^[A-Za-z0-9 \-]/,
 * so the value reaching this helper is always charset-clean.
 *
 * Rules (highest priority first):
 * 1. Empty (after trim)       → "empty"
 * 2. <2 chars (after trim)    → "tooShort"
 * 3. Case-insensitive trim-match against any OTHER row → "duplicate"
 * 4. Otherwise → null
 */
export type CustomRowError = "empty" | "tooShort" | "duplicate";

export function validateCustomRow(
  value: string,
  allValues: string[],
  rowIndex: number,
): CustomRowError | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length < 2) return "tooShort";

  const needle = trimmed.toLowerCase();
  for (let i = 0; i < allValues.length; i++) {
    if (i === rowIndex) continue;
    if (allValues[i].trim().toLowerCase() === needle) return "duplicate";
  }
  return null;
}
