"use client";

import Avatar from "@/components/ui/Avatar";

interface AvatarCarouselProps {
  seeds: string[];
  selectedSeed: string;
  onSelect: (seed: string) => void;
  onShuffle: () => void;
}

export default function AvatarCarousel({
  seeds,
  selectedSeed,
  onSelect,
  onShuffle,
}: AvatarCarouselProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="avatar-carousel-label" className="text-sm font-semibold text-foreground">
          Choose your avatar
        </h2>
        <button
          type="button"
          onClick={onShuffle}
          aria-label="Shuffle avatars"
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          Shuffle
        </button>
      </div>

      <div
        role="radiogroup"
        aria-labelledby="avatar-carousel-label"
        className="grid grid-cols-3 gap-3 sm:grid-cols-6"
      >
        {seeds.map((seed) => {
          const selected = seed === selectedSeed;
          return (
            <button
              key={seed}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(seed)}
              className={[
                "flex aspect-square items-center justify-center rounded-xl border-2 p-1 transition-all",
                "min-h-11 min-w-11",
                selected
                  ? "border-primary bg-primary/10 animate-score-pop"
                  : "border-border hover:border-accent",
              ].join(" ")}
            >
              <Avatar seed={seed} size={64} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
