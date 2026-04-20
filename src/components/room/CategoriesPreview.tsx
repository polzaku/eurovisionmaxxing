"use client";

import { useId, useState } from "react";

export interface CategoryPreviewItem {
  name: string;
  hint?: string;
}

interface CategoriesPreviewProps {
  categories: CategoryPreviewItem[];
}

/**
 * Lobby-side sneak peek of what categories this room will vote on.
 * Renders names as chips; tapping a chip toggles a callout below with
 * that category's hint (for predefined templates). Single-selection —
 * opening one chip closes any other.
 *
 * Hints are intentionally hidden behind a tap rather than always shown:
 * always-visible hints become a wall of text in the lobby, and the
 * voting card will re-surface the hint next to the 1-10 buttons where
 * it's contextually useful during scoring.
 */
export default function CategoriesPreview({
  categories,
}: CategoriesPreviewProps) {
  const [open, setOpen] = useState<string | null>(null);
  const calloutId = useId();

  if (categories.length === 0) return null;

  const openCategory = categories.find((c) => c.name === open);
  const hint = openCategory?.hint;
  const anyHintAvailable = categories.some((c) => Boolean(c.hint));

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          You&rsquo;ll be rating
        </h2>
        {anyHintAvailable && (
          <p className="text-xs text-muted-foreground">
            Tap for details
          </p>
        )}
      </div>
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => {
          const isOpen = c.name === open;
          const hasHint = Boolean(c.hint);
          return (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : c.name)}
                disabled={!hasHint}
                aria-expanded={isOpen}
                aria-controls={hasHint ? calloutId : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                  isOpen
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card hover:border-accent active:bg-muted"
                } ${hasHint ? "cursor-pointer" : "cursor-default opacity-80"}`}
              >
                <span>{c.name}</span>
                {hasHint && (
                  <span
                    aria-hidden
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none ${
                      isOpen
                        ? "border-primary text-primary"
                        : "border-muted-foreground text-muted-foreground"
                    }`}
                  >
                    {isOpen ? "\u2212" : "i"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {hint && (
        <p
          id={calloutId}
          role="region"
          aria-label={`About ${openCategory?.name ?? ""}`}
          className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground animate-fade-in"
        >
          <span className="font-medium text-foreground">
            {openCategory?.name}
          </span>{" "}
          &mdash; {hint}
        </p>
      )}
    </section>
  );
}
