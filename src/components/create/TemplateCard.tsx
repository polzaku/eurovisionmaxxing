"use client";

import { useTranslations } from "next-intl";
import type { VotingTemplate } from "@/types";

interface TemplateCardProps {
  template: VotingTemplate;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleInfo: () => void;
}

export default function TemplateCard({
  template,
  selected,
  expanded,
  onSelect,
  onToggleInfo,
}: TemplateCardProps) {
  const t = useTranslations();
  const name = template.nameKey ? t(template.nameKey) : template.name;
  const description = template.descriptionKey
    ? t(template.descriptionKey)
    : template.description;

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
          <p className="font-semibold">{name}</p>
          <span
            role="button"
            tabIndex={0}
            aria-label={t("templates.infoButtonAria", { name })}
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
        <p className="text-sm text-muted-foreground">{description}</p>
        {expanded && (
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground border-t border-border pt-3">
            {template.categories.map((c) => (
              <li key={c.key ?? c.name}>
                <span className="font-medium text-foreground">
                  {c.nameKey ? t(c.nameKey) : c.name}
                </span>
                {c.hintKey ? (
                  <> &mdash; {t(c.hintKey)}</>
                ) : c.hint ? (
                  <> &mdash; {c.hint}</>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </button>
    </div>
  );
}
