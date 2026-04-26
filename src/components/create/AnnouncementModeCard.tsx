"use client";

import { useTranslations } from "next-intl";

type Mode = "live" | "instant";

interface AnnouncementModeCardProps {
  mode: Mode;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleInfo: () => void;
}

const TITLES: Record<Mode, string> = {
  live: "Live",
  instant: "Instant",
};

export default function AnnouncementModeCard({
  mode,
  selected,
  expanded,
  onSelect,
  onToggleInfo,
}: AnnouncementModeCardProps) {
  const t = useTranslations();
  return (
    <div
      className={`rounded-lg border-2 transition-all ${
        selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-border hover:border-accent"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left px-4 py-3 space-y-1"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold">{TITLES[mode]}</p>
          <span
            role="button"
            tabIndex={0}
            aria-label={t("announcementMode.infoButtonAria", { mode })}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggleInfo();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onToggleInfo();
              }
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-muted-foreground text-xs text-muted-foreground hover:text-foreground hover:border-foreground cursor-pointer"
          >
            i
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(`announcementMode.${mode}.tagline`)}
        </p>
        {expanded && (
          <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
            {t(`announcementMode.${mode}.long`)}
          </p>
        )}
      </button>
    </div>
  );
}
