"use client";

import Button from "@/components/ui/Button";

export interface EndVotingModalProps {
  isOpen: boolean;
  busy?: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function EndVotingModal({
  isOpen,
  busy = false,
  errorMessage,
  onConfirm,
  onCancel,
}: EndVotingModalProps) {
  if (!isOpen) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-voting-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-card p-5 shadow-xl space-y-4">
        <h2
          id="end-voting-modal-title"
          className="text-lg font-bold text-foreground"
        >
          End voting?
        </h2>
        <p className="text-sm text-muted-foreground">
          Tapping <span className="font-semibold">End voting</span> starts a 5-second countdown.
          You can tap <span className="font-semibold">Undo</span> during the countdown to cancel.
        </p>
        {errorMessage ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {errorMessage}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Ending…" : "End voting"}
          </Button>
        </div>
      </div>
    </div>
  );
}
