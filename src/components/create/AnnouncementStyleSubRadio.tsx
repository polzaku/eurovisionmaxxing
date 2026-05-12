"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Style = "full" | "short";

interface AnnouncementStyleSubRadioProps {
  value: Style;
  onChange: (next: Style) => void;
  disabled?: boolean;
}

/**
 * SPEC §10.2.2 — sub-radio shown beneath the "Live" option in the
 * create wizard and the lobby-edit panel. Two options:
 *   - Full reveal (default): every point 1→12 announced live.
 *   - Short reveal — Eurovision style: only the 12-point pick is live;
 *     lower points (1, 2, 3, 4, 5, 6, 7, 8, 10) auto-batch at each
 *     announcer's turn-start.
 *
 * Includes an info-button → tooltip with the locked spec copy.
 */
export default function AnnouncementStyleSubRadio({
  value,
  onChange,
  disabled = false,
}: AnnouncementStyleSubRadioProps) {
  const t = useTranslations();
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const renderButton = (style: Style) => {
    const isShort = style === "short";
    const selected = value === style;
    return (
      <button
        key={style}
        type="button"
        aria-pressed={selected}
        disabled={disabled || selected}
        onClick={() => onChange(style)}
        className={`relative w-full rounded-lg border-2 px-4 py-3 text-left text-sm transition-all ${
          selected
            ? "border-primary bg-primary/10 cursor-default"
            : "border-border hover:border-accent disabled:opacity-50"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold">{t(`announcementStyle.${style}.label`)}</p>
          {isShort && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t("announcementStyle.subradioLabel")}
              aria-expanded={tooltipOpen}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setTooltipOpen((v) => !v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setTooltipOpen((v) => !v);
                }
              }}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground"
            >
              i
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {t(`announcementStyle.${style}.tagline`)}
        </p>
      </button>
    );
  };

  return (
    <div className="space-y-2" data-testid="announcement-style-subradio">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("announcementStyle.subradioLabel")}
      </p>
      <div className="grid grid-cols-1 gap-2">
        {renderButton("full")}
        {renderButton("short")}
      </div>
      {tooltipOpen && (
        <p className="text-xs text-muted-foreground border-l-2 border-accent pl-3 py-1">
          {t("announcementStyle.short.tooltip")}
        </p>
      )}
    </div>
  );
}
