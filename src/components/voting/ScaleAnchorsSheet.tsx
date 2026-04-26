"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

export interface ScaleAnchorsSheetProps {
  open: boolean;
  onClose: () => void;
}

const ANCHORS: ReadonlyArray<{ value: 1 | 5 | 10; key: "1" | "5" | "10" }> = [
  { value: 1, key: "1" },
  { value: 5, key: "5" },
  { value: 10, key: "10" },
];

export default function ScaleAnchorsSheet({
  open,
  onClose,
}: ScaleAnchorsSheetProps) {
  const t = useTranslations();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Capture the element that had focus before the sheet opened.
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // Move focus into the dialog so screen readers announce the title.
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
      // Restore focus to the previously-focused element.
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scale-anchors-title"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className="relative w-full max-w-xl bg-background rounded-t-xl border-t border-border p-6 space-y-4 animate-fade-in"
      >
        <div className="flex items-center justify-between">
          <h2
            id="scale-anchors-title"
            className="text-lg font-bold tracking-tight"
          >
            {t("voting.scale.title")}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("voting.scale.closeAria")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-3">
          {ANCHORS.map(({ value, key }) => (
            <li key={value} className="flex items-baseline gap-3">
              <span className="text-2xl font-bold text-primary tabular-nums w-8 text-right">
                {value}
              </span>
              <span className="text-base text-foreground">
                {t(`voting.scale.${key}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
