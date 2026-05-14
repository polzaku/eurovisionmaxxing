"use client";

import { useEffect, useRef } from "react";

export interface DrillDownSheetProps {
  open: boolean;
  onClose: () => void;
  /** Element id inside `children` that names the dialog (for aria-labelledby). */
  titleId: string;
  closeAriaLabel: string;
  children: React.ReactNode;
}

/**
 * SPEC §12.6 — shared bottom-sheet shell for the three drill-down variants.
 *
 * Adapted from <ScaleAnchorsSheet> (src/components/voting/ScaleAnchorsSheet.tsx):
 * - Fixed-position dialog with a backdrop click target.
 * - ESC closes via document-level keydown handler installed while open.
 * - Focus moves to the close button on open; restores the previously
 *   focused element on close.
 * - role="dialog" + aria-modal + aria-labelledby pointing at the title
 *   element rendered by the variant body (each body emits its own
 *   <h2 id={titleId}>).
 */
export default function DrillDownSheet({
  open,
  onClose,
  titleId,
  closeAriaLabel,
  children,
}: DrillDownSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <div
        data-testid="drill-down-backdrop"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        data-testid="drill-down-panel"
        className="relative w-full max-w-2xl bg-background rounded-t-xl border-t border-border max-h-[85vh] overflow-y-auto motion-safe:animate-fade-in"
      >
        <div className="sticky top-0 flex items-center justify-end bg-background/95 backdrop-blur border-b border-border px-4 py-2">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={closeAriaLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}
