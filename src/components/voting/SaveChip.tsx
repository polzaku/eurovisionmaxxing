import type { SaveStatus } from "@/lib/voting/Autosaver";

export interface SaveChipProps {
  status: SaveStatus;
}

/**
 * Persistent save indicator per SPEC §8.5. Renders nothing in `idle`.
 * The `error` state is a PR-1 placeholder that becomes `offline` once
 * PR 2 lands (offline queue + localStorage).
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
