"use client";

import { useTranslations } from "next-intl";
import {
  validateCustomRow,
  type CustomRowError,
} from "@/lib/create/validateCustomRow";

const MAX_ROWS = 8;
const NAME_MAX_LEN = 24;
const VALID_CHAR_REGEX = /[A-Za-z0-9 \-]/;

const ERROR_KEY: Record<CustomRowError, string> = {
  empty: "create.votingConfig.custom.errors.empty",
  tooShort: "create.votingConfig.custom.errors.tooShort",
  duplicate: "create.votingConfig.custom.errors.duplicate",
};

interface CustomTemplateCardProps {
  selected: boolean;
  customCategories: string[];
  onSelect: () => void;
  onChange: (next: string[]) => void;
}

/**
 * SPEC §7.2 (scoped MVP) — 4th template option in the create wizard.
 * Renders an inline editor when selected; collapsed otherwise. Every
 * row has weight=1 implicitly. ⓘ icon suppressed (unlike <TemplateCard>)
 * since the editor itself IS the preview when selected.
 */
export default function CustomTemplateCard({
  selected,
  customCategories,
  onSelect,
  onChange,
}: CustomTemplateCardProps) {
  const t = useTranslations();
  const count = customCategories.length;

  function handleRowChange(rowIndex: number, raw: string) {
    const filtered = Array.from(raw)
      .filter((ch) => VALID_CHAR_REGEX.test(ch))
      .join("")
      .slice(0, NAME_MAX_LEN);
    const next = customCategories.map((v, i) =>
      i === rowIndex ? filtered : v,
    );
    onChange(next);
  }

  function handleAddRow() {
    if (count >= MAX_ROWS) return;
    onChange([...customCategories, ""]);
  }

  function handleRemoveRow(rowIndex: number) {
    if (count <= 1) return;
    onChange(customCategories.filter((_, i) => i !== rowIndex));
  }

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
        <p className="font-semibold">{t("templates.custom.name")}</p>
        <p className="text-sm text-muted-foreground">
          {t("templates.custom.description")}
        </p>
      </button>

      {selected && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("create.votingConfig.custom.yourCategoriesHeading")}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("create.votingConfig.custom.rowCountLabel", {
                count,
                max: MAX_ROWS,
              })}
            </p>
          </div>

          <ul className="space-y-2">
            {customCategories.map((value, i) => {
              // Only check against earlier rows for duplicates so that
              // the first occurrence is not also flagged — ensures a single
              // error element per duplicate pair (later row is flagged).
              const error = validateCustomRow(value, customCategories.slice(0, i + 1), i);
              return (
                <li key={i} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={value}
                      placeholder={t(
                        "create.votingConfig.custom.namePlaceholder",
                      )}
                      maxLength={NAME_MAX_LEN}
                      onChange={(e) => handleRowChange(i, e.target.value)}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                      type="button"
                      aria-label={t(
                        "create.votingConfig.custom.removeAria",
                        { n: i + 1 },
                      )}
                      onClick={() => handleRemoveRow(i)}
                      disabled={count <= 1}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span aria-hidden>🗑</span>
                    </button>
                  </div>
                  {error && (
                    <p className="text-xs text-destructive">
                      {t(ERROR_KEY[error])}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={handleAddRow}
            disabled={count >= MAX_ROWS}
            className="text-sm font-medium text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
          >
            {t("create.votingConfig.custom.addCategoryButton")}
          </button>
        </div>
      )}
    </div>
  );
}
