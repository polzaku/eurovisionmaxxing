"use client";

import type { MissedUndoToast } from "@/lib/voting/MissedUndoController";

export interface MissedToastProps {
  toast: MissedUndoToast | null;
  onUndo: () => void;
  onDismiss?: () => void;
}

export default function MissedToast({
  toast,
  onUndo,
  onDismiss,
}: MissedToastProps) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 inset-x-4 mx-auto max-w-md z-20 rounded-xl border border-border bg-foreground text-background px-4 py-3 shadow-lg flex items-center justify-between gap-3 animate-fade-in"
    >
      <p className="text-sm flex-1">
        Marked missed — we&rsquo;ll estimate your scores as{" "}
        <span className="font-semibold tabular-nums">~{toast.projectedOverall}</span>.
      </p>
      <button
        type="button"
        onClick={onUndo}
        className="text-sm font-semibold underline underline-offset-2 hover:opacity-90 px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring rounded"
      >
        Undo
      </button>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="text-background/70 hover:text-background px-1 flex-shrink-0"
        >
          ×
        </button>
      )}
    </div>
  );
}
