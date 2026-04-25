import type { SaveStatus } from "@/lib/voting/Autosaver";

export type DisplaySaveStatus = SaveStatus | "offline";

export interface SaveChipProps {
  status: DisplaySaveStatus;
}

/**
 * Persistent save indicator per SPEC §8.5. Renders nothing in `idle`.
 *
 * 5 visual states after PR 2:
 *  - idle    → hidden
 *  - saving  → "Saving…" (muted)
 *  - saved   → "✓ Saved" (primary/gold)
 *  - offline → "Offline — changes queued" (accent/pink)
 *  - error   → "Save failed" (destructive/red) — genuine 4xx/5xx only;
 *              network errors route to the offline queue
 */
export default function SaveChip({ status }: SaveChipProps) {
  if (status === "idle") return null;
  const base = "text-xs font-medium";
  if (status === "saving") {
    return (
      <span className={`${base} text-muted-foreground`} aria-live="polite">
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className={`${base} text-primary`} aria-live="polite">
        ✓ Saved
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span className={`${base} text-accent`} aria-live="polite">
        Offline — changes queued
      </span>
    );
  }
  return (
    <span
      className={`${base} text-destructive`}
      aria-live="polite"
      role="alert"
    >
      Save failed
    </span>
  );
}
