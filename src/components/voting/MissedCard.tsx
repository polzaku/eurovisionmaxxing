"use client";

import Button from "@/components/ui/Button";
import type { ProjectedAverage } from "@/lib/voting/computeProjectedAverage";

export interface MissedCardProps {
  projected: ProjectedAverage;
  categories: { name: string }[];
  onRescore: () => void;
}

export default function MissedCard({
  projected,
  categories,
  onRescore,
}: MissedCardProps) {
  return (
    <div
      className="space-y-6 rounded-xl border border-border bg-muted/30 p-6"
      data-testid="missed-card"
    >
      <p className="text-sm text-muted-foreground text-center">
        This one&rsquo;s marked as missed
      </p>

      <div className="text-center space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Estimated score
        </p>
        <p className="text-5xl font-bold italic text-muted-foreground tabular-nums">
          ~{projected.overall}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Per category (estimated)
        </p>
        <ul className="space-y-1.5">
          {categories.map((c) => (
            <li
              key={c.name}
              className="flex items-baseline justify-between gap-2 text-sm"
            >
              <span className="text-foreground/80 truncate">{c.name}</span>
              <span className="text-muted-foreground italic font-medium tabular-nums flex-shrink-0">
                ~{projected.perCategory[c.name] ?? 5}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={onRescore}
      >
        Rescore this contestant
      </Button>
    </div>
  );
}
