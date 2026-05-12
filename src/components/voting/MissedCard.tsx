"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/Button";
import type { ProjectedAverage } from "@/lib/voting/computeProjectedAverage";

export interface MissedCardProps {
  projected: ProjectedAverage;
  categories: { name: string }[];
  onRescore: () => void;
}

const UPDATED_LABEL_MS = 2000;

function perCategoryEqual(
  a: ProjectedAverage["perCategory"],
  b: ProjectedAverage["perCategory"],
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

export default function MissedCard({
  projected,
  categories,
  onRescore,
}: MissedCardProps) {
  const t = useTranslations("voting.missed");
  // SPEC §8.4 / V8: when projected values shift due to the user scoring
  // other contestants, fire animate-score-pop on the changed cells and
  // surface a brief "updated from your recent votes" label so the user
  // understands why the number moved.
  const prevRef = useRef<ProjectedAverage | null>(null);
  const [updatedLabelVisible, setUpdatedLabelVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [changedOverall, setChangedOverall] = useState(false);
  const [changedCats, setChangedCats] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = projected;
    if (!prev) return; // first mount — no animation

    const overallShifted = prev.overall !== projected.overall;
    const perCatShifted = !perCategoryEqual(
      prev.perCategory,
      projected.perCategory,
    );
    if (!overallShifted && !perCatShifted) return;

    const nextChangedCats: Record<string, boolean> = {};
    for (const k of Object.keys(projected.perCategory)) {
      if (prev.perCategory[k] !== projected.perCategory[k]) {
        nextChangedCats[k] = true;
      }
    }
    setChangedOverall(overallShifted);
    setChangedCats(nextChangedCats);
    setAnimKey((n) => n + 1);
    setUpdatedLabelVisible(true);
    const timerId = window.setTimeout(
      () => setUpdatedLabelVisible(false),
      UPDATED_LABEL_MS,
    );
    return () => window.clearTimeout(timerId);
  }, [projected]);

  const overallClass =
    changedOverall && updatedLabelVisible
      ? "motion-safe:animate-score-pop"
      : "";

  return (
    <div
      className="space-y-6 rounded-xl border border-border bg-muted/30 p-6"
      data-testid="missed-card"
    >
      <p className="text-sm text-muted-foreground text-center">
        {t("cardLabel")}
      </p>

      <div className="text-center space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("estimatedLabel")}
        </p>
        <p
          key={`overall-${animKey}`}
          className={`text-5xl font-bold italic text-muted-foreground tabular-nums ${overallClass}`}
        >
          ~{projected.overall}
        </p>
        {updatedLabelVisible ? (
          <p
            role="status"
            aria-live="polite"
            data-testid="missed-updated-label"
            className="text-xs text-accent motion-safe:animate-fade-in"
          >
            {t("updatedLabel")}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("perCategoryLabel")}
        </p>
        <ul className="space-y-1.5">
          {categories.map((c) => {
            const catChanged = changedCats[c.name] && updatedLabelVisible;
            const catClass = catChanged ? "motion-safe:animate-score-pop" : "";
            return (
              <li
                key={c.name}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="text-foreground/80 truncate">{c.name}</span>
                <span
                  key={`cat-${c.name}-${animKey}`}
                  className={`text-muted-foreground italic font-medium tabular-nums flex-shrink-0 ${catClass}`}
                >
                  ~{projected.perCategory[c.name] ?? 5}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={onRescore}
      >
        {t("rescoreButton")}
      </Button>
    </div>
  );
}
