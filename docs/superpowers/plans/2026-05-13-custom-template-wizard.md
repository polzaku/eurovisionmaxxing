# Custom Template Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th "Custom" option to the create-room wizard's template grid. Selecting it opens an inline editor where the admin types 1–8 category names (weight=1 each), with per-row inline validation. Wizard-only — no lobby-edit reach.

**Architecture:** Pure presentational addition. New `<CustomTemplateCard>` plus a pure `validateCustomRow` helper. Wiring threads through `<VotingConfig>` and `<CreateRoomPage>` via a new `customCategories: string[]` controlled-state plumbed alongside the existing `templateId`. Server-side `validateCategories` already accepts this shape — no schema, no API, no realtime changes. Strings are translated via the existing `useTranslations()` pattern; locale keys added to all 5 bundles to keep `locales.test.ts` green.

**Tech Stack:** Next.js 14 + TypeScript strict + Tailwind + next-intl + vitest (RTL via jsdom per-file pragma) + Playwright (chromium, port 3457).

**Spec:** [docs/superpowers/specs/2026-05-13-custom-template-wizard-design.md](../specs/2026-05-13-custom-template-wizard-design.md)

**Branch:** `feat/wizard-custom-template` (already created from `origin/main`; spec commit `703c6ee` already landed after rebase).

---

## File map

**Create:**
- `src/lib/create/validateCustomRow.ts` — pure helper returning a discriminator-shaped error code (or `null` when valid)
- `src/lib/create/validateCustomRow.test.ts` — unit tests
- `src/components/create/CustomTemplateCard.tsx` — selectable template card with inline editor when selected
- `src/components/create/CustomTemplateCard.test.tsx` — RTL tests
- `tests/e2e/create-custom-template.spec.ts` — Playwright spec (3 cases, single-window, API-mocked)

**Modify:**
- `src/components/create/VotingConfig.tsx` — widen `TemplateId`, drop the custom filter, branch the map between `<TemplateCard>` and `<CustomTemplateCard>`, plumb `customCategories` + change-key
- `src/components/create/VotingConfig.test.tsx` — extend with custom-card cases
- `src/app/create/page.tsx` — widen `TemplateId`, add `customCategories` state, branch the submit's `categories` build, plumb props
- `src/locales/en.json` + `es.json` + `uk.json` + `fr.json` + `de.json` — add `create.votingConfig.custom.*` namespace

**Unchanged:**
- `src/lib/templates.ts` — `custom` entry already exists with `categories: []`
- `src/lib/rooms/validateCategories.ts` — already accepts the `{name, weight:1}` shape
- `src/lib/rooms/createRoom.ts`, API routes, `supabase/schema.sql`, realtime payloads
- Existing `create.votingConfig.{heading, subheading, templateLabel, ...}` keys

---

## Task 1 — Pure helper `validateCustomRow`

**Why first:** smallest, isolated, deterministic. TDD baseline before any component work.

**Files:**
- Create: `src/lib/create/validateCustomRow.ts`
- Create: `src/lib/create/validateCustomRow.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `src/lib/create/validateCustomRow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateCustomRow, type CustomRowError } from "./validateCustomRow";

describe("validateCustomRow", () => {
  it("returns null for a valid 2-char name with no duplicates", () => {
    expect(validateCustomRow("Vo", ["Vo"], 0)).toBeNull();
  });

  it("returns null for a 24-char name", () => {
    const name = "A".repeat(24);
    expect(validateCustomRow(name, [name], 0)).toBeNull();
  });

  it("returns 'empty' for an empty string", () => {
    const err: CustomRowError = "empty";
    expect(validateCustomRow("", [""], 0)).toBe(err);
  });

  it("returns 'empty' for whitespace-only input", () => {
    expect(validateCustomRow("   ", ["   "], 0)).toBe("empty");
  });

  it("returns 'tooShort' for a single character after trim", () => {
    expect(validateCustomRow("A", ["A"], 0)).toBe("tooShort");
  });

  it("returns 'tooShort' for a single character with surrounding whitespace", () => {
    expect(validateCustomRow("  A  ", ["  A  "], 0)).toBe("tooShort");
  });

  it("returns 'duplicate' when another row has the same trimmed lowercase name", () => {
    expect(validateCustomRow("Vocals", ["Music", "Vocals"], 1)).toBe(
      "duplicate",
    );
  });

  it("returns 'duplicate' case-insensitively", () => {
    expect(validateCustomRow("VOCALS", ["vocals", "VOCALS"], 1)).toBe(
      "duplicate",
    );
  });

  it("returns 'duplicate' regardless of trimming on either side", () => {
    expect(validateCustomRow("  Vocals  ", ["Vocals", "  Vocals  "], 1)).toBe(
      "duplicate",
    );
  });

  it("does NOT flag the row's own value as a duplicate of itself", () => {
    expect(validateCustomRow("Vocals", ["Music", "Vocals", "Drama"], 1))
      .toBeNull();
  });

  it("prioritises 'empty' over duplicate (empty rows don't claim duplication)", () => {
    expect(validateCustomRow("", ["", ""], 1)).toBe("empty");
  });

  it("prioritises 'tooShort' over duplicate", () => {
    expect(validateCustomRow("A", ["A", "A"], 1)).toBe("tooShort");
  });
});
```

- [ ] **Step 1.2: Run test, verify failure**

```bash
npx vitest run src/lib/create/validateCustomRow.test.ts
```

Expected: FAIL with `Cannot find module './validateCustomRow'`.

- [ ] **Step 1.3: Implement the helper**

Create `src/lib/create/validateCustomRow.ts`:

```ts
/**
 * Per-row validation for the custom template editor.
 *
 * Returns a discriminator code instead of a UI string so the caller can
 * map to translated copy via next-intl. Charset is NOT validated here —
 * the input component itself filters keystrokes against /^[A-Za-z0-9 \-]/,
 * so the value reaching this helper is always charset-clean.
 *
 * Rules (highest priority first):
 * 1. Empty (after trim)       → "empty"
 * 2. <2 chars (after trim)    → "tooShort"
 * 3. Case-insensitive trim-match against any OTHER row → "duplicate"
 * 4. Otherwise → null
 */
export type CustomRowError = "empty" | "tooShort" | "duplicate";

export function validateCustomRow(
  value: string,
  allValues: string[],
  rowIndex: number,
): CustomRowError | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length < 2) return "tooShort";

  const needle = trimmed.toLowerCase();
  for (let i = 0; i < allValues.length; i++) {
    if (i === rowIndex) continue;
    if (allValues[i].trim().toLowerCase() === needle) return "duplicate";
  }
  return null;
}
```

- [ ] **Step 1.4: Run tests, verify all pass**

```bash
npx vitest run src/lib/create/validateCustomRow.test.ts
```

Expected: 12 tests PASS.

- [ ] **Step 1.5: Type-check + commit**

```bash
npm run type-check
```

Expected: PASS.

```bash
git add src/lib/create/validateCustomRow.ts src/lib/create/validateCustomRow.test.ts
git commit -m "$(cat <<'EOF'
feat(create): validateCustomRow pure helper for custom-template rows

Returns a discriminator code ('empty' | 'tooShort' | 'duplicate' |
null) so the caller maps to translated UI copy. Rules per SPEC §7.2
subset: trim → empty < 2 chars → too short → case-insensitive trim-
match against other rows → duplicate. Charset is enforced at the
input layer; this helper assumes a clean string.

Used by the upcoming <CustomTemplateCard> editor row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Locale keys for the custom-template editor (5 bundles)

**Why second:** the `<CustomTemplateCard>` component (Task 3) will consume these keys via `useTranslations()`. Landing keys first keeps every intermediate commit's `locales.test.ts` green.

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/es.json`
- Modify: `src/locales/uk.json`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/de.json`

- [ ] **Step 2.1: Add `create.votingConfig.custom.*` to `src/locales/en.json`**

Find the existing `create.votingConfig` block (the JSON object that ends with `"nowPerformingInfoAria": "About this toggle"`):

```jsonc
    "votingConfig": {
      "heading": "Voting setup",
      "subheading": "Pick a template and how you want results revealed.",
      "templateLabel": "Template",
      "announcementLabel": "Announcement",
      "nowPerformingLabel": "Sync everyone to the performing act",
      "nowPerformingInfo": "Lets you tap the currently-performing country to bring all guests to that card during voting. Off by default.",
      "nowPerformingInfoAria": "About this toggle"
    },
```

Replace with:

```jsonc
    "votingConfig": {
      "heading": "Voting setup",
      "subheading": "Pick a template and how you want results revealed.",
      "templateLabel": "Template",
      "announcementLabel": "Announcement",
      "nowPerformingLabel": "Sync everyone to the performing act",
      "nowPerformingInfo": "Lets you tap the currently-performing country to bring all guests to that card during voting. Off by default.",
      "nowPerformingInfoAria": "About this toggle",
      "custom": {
        "yourCategoriesHeading": "Your categories",
        "rowCountLabel": "{count}/{max} categories",
        "namePlaceholder": "Category name",
        "addCategoryButton": "+ Add category",
        "removeAria": "Remove category {n}",
        "errors": {
          "empty": "Add a name",
          "tooShort": "At least 2 characters",
          "duplicate": "Already in your list"
        }
      }
    },
```

- [ ] **Step 2.2: Add the same keys to `src/locales/es.json`**

Find the equivalent `votingConfig` block in `es.json` (same path; existing `nowPerformingInfoAria` value will be locale-specific). Insert the `custom` sub-object as a sibling with these Spanish strings:

```jsonc
      "custom": {
        "yourCategoriesHeading": "Tus categorías",
        "rowCountLabel": "{count}/{max} categorías",
        "namePlaceholder": "Nombre de la categoría",
        "addCategoryButton": "+ Añadir categoría",
        "removeAria": "Eliminar categoría {n}",
        "errors": {
          "empty": "Añade un nombre",
          "tooShort": "Mínimo 2 caracteres",
          "duplicate": "Ya está en tu lista"
        }
      }
```

(Same trailing-comma handling: add a comma after the existing last key (`nowPerformingInfoAria`), then the `custom` block as the new last entry inside `votingConfig`.)

- [ ] **Step 2.3: Add the same keys to `src/locales/uk.json`**

Ukrainian strings:

```jsonc
      "custom": {
        "yourCategoriesHeading": "Твої категорії",
        "rowCountLabel": "{count}/{max} категорій",
        "namePlaceholder": "Назва категорії",
        "addCategoryButton": "+ Додати категорію",
        "removeAria": "Видалити категорію {n}",
        "errors": {
          "empty": "Додай назву",
          "tooShort": "Мінімум 2 символи",
          "duplicate": "Вже у твоєму списку"
        }
      }
```

- [ ] **Step 2.4: Add the same keys to `src/locales/fr.json`**

French strings:

```jsonc
      "custom": {
        "yourCategoriesHeading": "Tes catégories",
        "rowCountLabel": "{count}/{max} catégories",
        "namePlaceholder": "Nom de la catégorie",
        "addCategoryButton": "+ Ajouter une catégorie",
        "removeAria": "Supprimer la catégorie {n}",
        "errors": {
          "empty": "Ajoute un nom",
          "tooShort": "Au moins 2 caractères",
          "duplicate": "Déjà dans ta liste"
        }
      }
```

- [ ] **Step 2.5: Add the same keys to `src/locales/de.json`**

German strings:

```jsonc
      "custom": {
        "yourCategoriesHeading": "Deine Kategorien",
        "rowCountLabel": "{count}/{max} Kategorien",
        "namePlaceholder": "Kategoriename",
        "addCategoryButton": "+ Kategorie hinzufügen",
        "removeAria": "Kategorie {n} entfernen",
        "errors": {
          "empty": "Gib einen Namen ein",
          "tooShort": "Mindestens 2 Zeichen",
          "duplicate": "Schon in deiner Liste"
        }
      }
```

- [ ] **Step 2.6: Verify JSON validity + key parity**

```bash
for f in src/locales/{en,es,uk,fr,de}.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f OK"; done
```

Expected: 5 lines reading `… OK`.

```bash
npx vitest run src/locales/locales.test.ts
```

Expected: 4 tests PASS (es/uk/fr/de each contain every en key).

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 2.7: Commit**

```bash
git add src/locales/en.json src/locales/es.json src/locales/uk.json src/locales/fr.json src/locales/de.json
git commit -m "$(cat <<'EOF'
i18n: create.votingConfig.custom.* for the custom-template editor

Adds yourCategoriesHeading, rowCountLabel (ICU {count}/{max}),
namePlaceholder, addCategoryButton, removeAria ({n}), and three
inline-error variants (empty / tooShort / duplicate) to all 5 locale
bundles. Consumed by the upcoming <CustomTemplateCard> component in
the next commit. locales.test.ts continues to pass — every en key is
mirrored in es/uk/fr/de.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — `<CustomTemplateCard>` component + RTL tests

**Why third:** consumes Task 1's helper + Task 2's keys. Self-contained component before wiring into `<VotingConfig>`.

**Files:**
- Create: `src/components/create/CustomTemplateCard.tsx`
- Create: `src/components/create/CustomTemplateCard.test.tsx`

- [ ] **Step 3.1: Write the failing RTL tests**

Create `src/components/create/CustomTemplateCard.test.tsx`. Note: the next-intl mock returns the key path verbatim (matching the existing `VotingConfig.test.tsx` pattern); tests assert on key strings, not translated copy.

```tsx
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import CustomTemplateCard from "./CustomTemplateCard";

afterEach(() => cleanup());

const BASE_PROPS = {
  selected: true,
  customCategories: [""],
  onSelect: vi.fn(),
  onChange: vi.fn(),
};

describe("CustomTemplateCard — collapsed state", () => {
  it("renders the name and description when not selected, no editor", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        selected={false}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    // Name + description come from the templates.custom.* keys.
    expect(screen.getByText("templates.custom.name")).toBeInTheDocument();
    expect(
      screen.getByText("templates.custom.description"),
    ).toBeInTheDocument();
    // Editor body is hidden when collapsed
    expect(
      screen.queryByText("create.votingConfig.custom.addCategoryButton"),
    ).not.toBeInTheDocument();
  });

  it("calls onSelect when the card is clicked", () => {
    const onSelect = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        selected={false}
        onSelect={onSelect}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("templates.custom.name"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("CustomTemplateCard — expanded editor", () => {
  it("renders 1 row with empty input and the +Add button when selected with one starter row", () => {
    render(<CustomTemplateCard {...BASE_PROPS} onChange={vi.fn()} />);
    const inputs = screen.getAllByPlaceholderText(
      "create.votingConfig.custom.namePlaceholder",
    );
    expect(inputs).toHaveLength(1);
    expect(
      screen.getByText("create.votingConfig.custom.addCategoryButton"),
    ).toBeInTheDocument();
  });

  it("disables the trash button when only one row is present", () => {
    render(<CustomTemplateCard {...BASE_PROPS} onChange={vi.fn()} />);
    const trash = screen.getByRole("button", {
      // aria-label = key:"{\"n\":1}" (per the mock's params printer)
      name: /create\.votingConfig\.custom\.removeAria/i,
    });
    expect(trash).toBeDisabled();
  });

  it("renders the row counter with the right ICU params", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", "Drama", "Outfit"]}
        onChange={vi.fn()}
      />,
    );
    // Mock returns "{key}:{paramsJson}" → look for the count value in the
    // rendered text (count=3, max=8).
    expect(
      screen.getByText(/create\.votingConfig\.custom\.rowCountLabel.*"count":3.*"max":8/),
    ).toBeInTheDocument();
  });

  it("fires onChange with the updated array when a row's input changes", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vo", "Drama"]}
        onChange={onChange}
      />,
    );
    const firstInput = screen.getAllByPlaceholderText(
      "create.votingConfig.custom.namePlaceholder",
    )[0];
    fireEvent.change(firstInput, { target: { value: "Vocals" } });
    expect(onChange).toHaveBeenCalledWith(["Vocals", "Drama"]);
  });

  it("filters out characters outside [A-Za-z0-9 -] on input change", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={[""]}
        onChange={onChange}
      />,
    );
    const input = screen.getAllByPlaceholderText(
      "create.votingConfig.custom.namePlaceholder",
    )[0];
    fireEvent.change(input, { target: { value: "Vocals!@#" } });
    expect(onChange).toHaveBeenCalledWith(["Vocals"]);
  });

  it("truncates input to 24 characters", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={[""]}
        onChange={onChange}
      />,
    );
    const input = screen.getAllByPlaceholderText(
      "create.votingConfig.custom.namePlaceholder",
    )[0];
    fireEvent.change(input, { target: { value: "A".repeat(30) } });
    expect(onChange).toHaveBeenCalledWith(["A".repeat(24)]);
  });

  it("calls onChange with an appended empty row when +Add is clicked", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByText("create.votingConfig.custom.addCategoryButton"),
    );
    expect(onChange).toHaveBeenCalledWith(["Vocals", ""]);
  });

  it("disables +Add when there are 8 rows", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={[
          "Vocals",
          "Drama",
          "Outfit",
          "Music",
          "Vibes",
          "Energy",
          "Lyrics",
          "Stage",
        ]}
        onChange={vi.fn()}
      />,
    );
    const addBtn = screen.getByText(
      "create.votingConfig.custom.addCategoryButton",
    );
    expect(addBtn).toBeDisabled();
  });

  it("removes a row when trash is clicked (multi-row state)", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", "Drama", "Outfit"]}
        onChange={onChange}
      />,
    );
    // Each trash button's aria-label is "create.votingConfig.custom.removeAria:{...n:2}"
    const trashButtons = screen.getAllByRole("button", {
      name: /create\.votingConfig\.custom\.removeAria/i,
    });
    fireEvent.click(trashButtons[1]); // remove row 2
    expect(onChange).toHaveBeenCalledWith(["Vocals", "Outfit"]);
  });

  it("shows the empty-name error on a row with empty value", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", ""]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("create.votingConfig.custom.errors.empty"),
    ).toBeInTheDocument();
  });

  it("shows the too-short error on a 1-character row", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["A"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("create.votingConfig.custom.errors.tooShort"),
    ).toBeInTheDocument();
  });

  it("shows the duplicate error on a case-insensitive duplicate row", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", "VOCALS"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("create.votingConfig.custom.errors.duplicate"),
    ).toBeInTheDocument();
  });

  it("does not show an error on a valid row", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", "Drama"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("create.votingConfig.custom.errors.empty"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("create.votingConfig.custom.errors.tooShort"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("create.votingConfig.custom.errors.duplicate"),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run test, verify failure**

```bash
npx vitest run src/components/create/CustomTemplateCard.test.tsx
```

Expected: FAIL with `Cannot find module './CustomTemplateCard'`.

- [ ] **Step 3.3: Implement the component**

Create `src/components/create/CustomTemplateCard.tsx`:

```tsx
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
    // Filter to [A-Za-z0-9 \-] character-by-character; cap at 24 chars.
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
              const error = validateCustomRow(value, customCategories, i);
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
```

- [ ] **Step 3.4: Run tests, verify all pass**

```bash
npx vitest run src/components/create/CustomTemplateCard.test.tsx
```

Expected: 15 tests PASS.

- [ ] **Step 3.5: Type-check + commit**

```bash
npm run type-check
```

Expected: PASS.

```bash
git add src/components/create/CustomTemplateCard.tsx src/components/create/CustomTemplateCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(create): CustomTemplateCard — inline editor for custom categories

Selectable 4th template card with an inline editor that appears when
selected. 1–8 admin-named rows; each row is a single text input
filtered to /[A-Za-z0-9 \-]/ and capped at 24 chars. Trash button per
row (disabled at 1-row floor); + Add disabled at 8-row ceiling. Per-
row inline error driven by validateCustomRow (empty / tooShort /
duplicate). ⓘ icon suppressed (the editor IS the preview when
selected). All copy via create.votingConfig.custom.* locale keys.

15 RTL cases cover collapsed/expanded shape, click-to-select, input
filtering, max-length cap, add/remove with floor/ceiling, and each
of the three inline errors. Test mock returns the key path verbatim
— assertions check key strings, not translated copy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Wire `<VotingConfig>` to render the Custom card

**Why fourth:** plumbs the new component into the existing template grid. Tests in this same task verify the integration.

**Files:**
- Modify: `src/components/create/VotingConfig.tsx`
- Modify: `src/components/create/VotingConfig.test.tsx`

- [ ] **Step 4.1: Update VotingConfig.tsx — widen TemplateId, drop filter, branch the map**

Edit `src/components/create/VotingConfig.tsx`. Four edits.

**Edit A** — widen the `TemplateId` type. Find:

```ts
type TemplateId = "classic" | "spectacle" | "bangerTest";
```

Replace with:

```ts
type TemplateId = "classic" | "spectacle" | "bangerTest" | "custom";
```

**Edit B** — extend the prop interface. Find:

```ts
interface VotingConfigProps {
  templateId: TemplateId;
  announcementMode: Mode;
  announcementStyle: 'full' | 'short';
  allowNowPerforming: boolean;
  submitState: SubmitState;
  onChange: (patch: {
    templateId?: TemplateId;
    announcementMode?: Mode;
    announcementStyle?: 'full' | 'short';
    allowNowPerforming?: boolean;
  }) => void;
  onBack: () => void;
  onSubmit: () => void;
}
```

Replace with:

```ts
interface VotingConfigProps {
  templateId: TemplateId;
  customCategories: string[];
  announcementMode: Mode;
  announcementStyle: 'full' | 'short';
  allowNowPerforming: boolean;
  submitState: SubmitState;
  onChange: (patch: {
    templateId?: TemplateId;
    customCategories?: string[];
    announcementMode?: Mode;
    announcementStyle?: 'full' | 'short';
    allowNowPerforming?: boolean;
  }) => void;
  onBack: () => void;
  onSubmit: () => void;
}
```

**Edit C** — destructure the new prop. Find:

```ts
export default function VotingConfig({
  templateId,
  announcementMode,
  announcementStyle,
  allowNowPerforming,
  submitState,
  onChange,
  onBack,
  onSubmit,
}: VotingConfigProps) {
```

Replace with:

```ts
export default function VotingConfig({
  templateId,
  customCategories,
  announcementMode,
  announcementStyle,
  allowNowPerforming,
  submitState,
  onChange,
  onBack,
  onSubmit,
}: VotingConfigProps) {
```

**Edit D** — add import, drop the custom filter, branch the template-grid map. Find the existing import block (top of file) and add this import as a new line below the existing `import TemplateCard from "./TemplateCard";`:

```ts
import CustomTemplateCard from "./CustomTemplateCard";
```

Find:

```ts
  const templates = VOTING_TEMPLATES.filter((t) => t.id !== "custom");
```

Replace with:

```ts
  const templates = VOTING_TEMPLATES;
```

Find the template-grid map block:

```tsx
        <div className="grid grid-cols-1 gap-3">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              selected={tpl.id === templateId}
              expanded={expandedTemplateId === (tpl.id as TemplateId)}
              onSelect={() =>
                onChange({ templateId: tpl.id as TemplateId })
              }
              onToggleInfo={() =>
                setExpandedTemplateId((curr) =>
                  nextExpandedId(curr, tpl.id as TemplateId),
                )
              }
            />
          ))}
        </div>
```

Replace with:

```tsx
        <div className="grid grid-cols-1 gap-3">
          {templates.map((tpl) =>
            tpl.id === "custom" ? (
              <CustomTemplateCard
                key={tpl.id}
                selected={templateId === "custom"}
                customCategories={customCategories}
                onSelect={() => onChange({ templateId: "custom" })}
                onChange={(next) =>
                  onChange({ customCategories: next })
                }
              />
            ) : (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                selected={tpl.id === templateId}
                expanded={expandedTemplateId === (tpl.id as TemplateId)}
                onSelect={() =>
                  onChange({ templateId: tpl.id as TemplateId })
                }
                onToggleInfo={() =>
                  setExpandedTemplateId((curr) =>
                    nextExpandedId(curr, tpl.id as TemplateId),
                  )
                }
              />
            ),
          )}
        </div>
```

- [ ] **Step 4.2: Update VotingConfig.test.tsx — extend BASE_PROPS + add custom cases**

Edit `src/components/create/VotingConfig.test.tsx`.

**Edit A** — extend `BASE_PROPS`. Find:

```ts
const BASE_PROPS = {
  templateId: "classic" as const,
  announcementMode: "instant" as const,
  announcementStyle: "full" as const,
  allowNowPerforming: false,
  submitState: { kind: "idle" as const },
  onChange: vi.fn(),
  onBack: vi.fn(),
  onSubmit: vi.fn(),
};
```

Replace with:

```ts
const BASE_PROPS = {
  templateId: "classic" as const,
  customCategories: [""],
  announcementMode: "instant" as const,
  announcementStyle: "full" as const,
  allowNowPerforming: false,
  submitState: { kind: "idle" as const },
  onChange: vi.fn(),
  onBack: vi.fn(),
  onSubmit: vi.fn(),
};
```

**Edit B** — add a new describe block at the bottom of the file (after the last existing `});` of the final describe block, but before the file ends). The new tests assert against the key-string outputs the inline next-intl mock produces:

```tsx
describe("VotingConfig — custom template", () => {
  it("renders the Custom template card in the grid", () => {
    render(
      <VotingConfig
        {...BASE_PROPS}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("templates.custom.name")).toBeInTheDocument();
  });

  it("does not show the editor when Custom is not selected", () => {
    render(
      <VotingConfig
        {...BASE_PROPS}
        templateId="classic"
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.queryByPlaceholderText(
        "create.votingConfig.custom.namePlaceholder",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows the editor when Custom is selected", () => {
    render(
      <VotingConfig
        {...BASE_PROPS}
        templateId="custom"
        customCategories={["Vocals"]}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByPlaceholderText(
        "create.votingConfig.custom.namePlaceholder",
      ),
    ).toBeInTheDocument();
  });

  it("fires onChange({ templateId: 'custom' }) when the Custom card is clicked", () => {
    const onChange = vi.fn();
    render(
      <VotingConfig
        {...BASE_PROPS}
        templateId="classic"
        onChange={onChange}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("templates.custom.name"));
    expect(onChange).toHaveBeenCalledWith({ templateId: "custom" });
  });

  it("fires onChange({ customCategories: ... }) when an editor row changes", () => {
    const onChange = vi.fn();
    render(
      <VotingConfig
        {...BASE_PROPS}
        templateId="custom"
        customCategories={["Vo"]}
        onChange={onChange}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "create.votingConfig.custom.namePlaceholder",
      ),
      { target: { value: "Vocals" } },
    );
    expect(onChange).toHaveBeenCalledWith({ customCategories: ["Vocals"] });
  });
});
```

- [ ] **Step 4.3: Run tests, type-check**

```bash
npx vitest run src/components/create/VotingConfig.test.tsx
```

Expected: previous tests still PASS + 5 new tests PASS.

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 4.4: Commit**

```bash
git add src/components/create/VotingConfig.tsx src/components/create/VotingConfig.test.tsx
git commit -m "$(cat <<'EOF'
feat(create): wire CustomTemplateCard into VotingConfig

Widens TemplateId to include 'custom', drops the custom filter, and
branches the template-grid map: 'custom' → <CustomTemplateCard>, all
others → <TemplateCard>. Adds customCategories prop + onChange patch
key so the parent owns the editor's state.

5 new RTL cases pin the integration: Custom card renders, editor
hidden when not selected, editor visible when selected, click fires
onChange({ templateId: 'custom' }), row edit fires onChange with the
updated customCategories array.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Wire `<CreateRoomPage>` to own customCategories + branch submit

**Why fifth:** completes the data flow. Parent state lives in the page so it survives template switches.

**Files:**
- Modify: `src/app/create/page.tsx`

- [ ] **Step 5.1: Update page.tsx — widen TemplateId, add state, branch submit, plumb props**

Edit `src/app/create/page.tsx`. Five changes.

**Edit A** — widen `TemplateId`. Find:

```ts
type TemplateId = "classic" | "spectacle" | "bangerTest";
```

Replace with:

```ts
type TemplateId = "classic" | "spectacle" | "bangerTest" | "custom";
```

**Edit B** — add `customCategories` state. Find:

```ts
  // Step 2 state
  const [templateId, setTemplateId] = useState<TemplateId>("classic");
```

Replace with:

```ts
  // Step 2 state
  const [templateId, setTemplateId] = useState<TemplateId>("classic");
  const [customCategories, setCustomCategories] = useState<string[]>([""]);
```

**Edit C** — add the memoised validity helper just above `const handleSubmit = useCallback(async () => {`:

```ts
  const isCustomValid = useCallback((rows: string[]): boolean => {
    if (rows.length < 1 || rows.length > 8) return false;
    const trimmed = rows.map((r) => r.trim().toLowerCase());
    if (new Set(trimmed).size !== trimmed.length) return false;
    return rows.every((r) =>
      /^[A-Za-z0-9 \-]{2,24}$/.test(r.trim()),
    );
  }, []);
```

**Edit D** — branch `handleSubmit` to build categories from custom rows when `templateId === "custom"`. Find:

```ts
    const template = VOTING_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      setSubmitState({
        kind: "error",
        message: mapCreateError("INVALID_CATEGORIES"),
      });
      return;
    }
    setSubmitState({ kind: "submitting" });
    const result = await createRoomApi(
      {
        year,
        event,
        categories: template.categories,
        announcementMode,
        announcementStyle,
        allowNowPerforming,
        userId: session.userId,
      },
      { fetch: window.fetch.bind(window) }
    );
```

Replace with:

```ts
    let categories;
    if (templateId === "custom") {
      if (!isCustomValid(customCategories)) {
        setSubmitState({
          kind: "error",
          message: mapCreateError("INVALID_CATEGORIES"),
        });
        return;
      }
      categories = customCategories.map((name) => ({
        name: name.trim(),
        weight: 1,
      }));
    } else {
      const template = VOTING_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        setSubmitState({
          kind: "error",
          message: mapCreateError("INVALID_CATEGORIES"),
        });
        return;
      }
      categories = template.categories;
    }
    setSubmitState({ kind: "submitting" });
    const result = await createRoomApi(
      {
        year,
        event,
        categories,
        announcementMode,
        announcementStyle,
        allowNowPerforming,
        userId: session.userId,
      },
      { fetch: window.fetch.bind(window) }
    );
```

Then update the `useCallback` dependency array. Find:

```ts
  }, [
    year,
    event,
    templateId,
    announcementMode,
    announcementStyle,
    allowNowPerforming,
    router,
  ]);
```

Replace with:

```ts
  }, [
    year,
    event,
    templateId,
    customCategories,
    isCustomValid,
    announcementMode,
    announcementStyle,
    allowNowPerforming,
    router,
  ]);
```

**Edit E** — plumb `customCategories` to `<VotingConfig>`. Find:

```tsx
        {step === 2 && (
          <VotingConfig
            templateId={templateId}
            announcementMode={announcementMode}
            announcementStyle={announcementStyle}
            allowNowPerforming={allowNowPerforming}
            submitState={submitState}
            onChange={(patch) => {
              if (patch.templateId !== undefined)
                setTemplateId(patch.templateId);
              if (patch.announcementMode !== undefined)
                setAnnouncementMode(patch.announcementMode);
              if (patch.announcementStyle !== undefined)
                setAnnouncementStyle(patch.announcementStyle);
              if (patch.allowNowPerforming !== undefined)
                setAllowNowPerforming(patch.allowNowPerforming);
            }}
            onBack={() => setStep(1)}
            onSubmit={() => void handleSubmit()}
          />
        )}
```

Replace with:

```tsx
        {step === 2 && (
          <VotingConfig
            templateId={templateId}
            customCategories={customCategories}
            announcementMode={announcementMode}
            announcementStyle={announcementStyle}
            allowNowPerforming={allowNowPerforming}
            submitState={submitState}
            onChange={(patch) => {
              if (patch.templateId !== undefined)
                setTemplateId(patch.templateId);
              if (patch.customCategories !== undefined)
                setCustomCategories(patch.customCategories);
              if (patch.announcementMode !== undefined)
                setAnnouncementMode(patch.announcementMode);
              if (patch.announcementStyle !== undefined)
                setAnnouncementStyle(patch.announcementStyle);
              if (patch.allowNowPerforming !== undefined)
                setAllowNowPerforming(patch.allowNowPerforming);
            }}
            onBack={() => setStep(1)}
            onSubmit={() => void handleSubmit()}
          />
        )}
```

- [ ] **Step 5.2: Type-check + verify the test suites under src/app/create still pass**

```bash
npm run type-check
```

Expected: PASS.

```bash
npx vitest run src/app/create
```

Expected: any existing tests under `src/app/create` still PASS (or the directory has no test files, in which case the command exits cleanly).

- [ ] **Step 5.3: Commit**

```bash
git add src/app/create/page.tsx
git commit -m "$(cat <<'EOF'
feat(create): page owns customCategories state + branches submit

CreateRoomPage now tracks customCategories: string[] alongside the
existing templateId. Initial value is one blank row. State persists
across template-switch round-trips (admin can click Custom → Classic →
Custom and find their rows intact).

handleSubmit branches on templateId === 'custom': builds categories =
rows.map(name => ({name: name.trim(), weight: 1})) when valid (1–8
rows, all charset-valid, all 2–24 chars, no case-insensitive dupes),
or fails fast with INVALID_CATEGORIES if not. Predefined templates use
the existing template.categories path unchanged.

isCustomValid is a memoised pure helper so handleSubmit's useCallback
deps don't churn on every customCategories tick.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Playwright spec

**Why sixth:** end-to-end happy-path coverage + boundary + POST-payload integrity, layered on top of vitest's per-component cases.

**Files:**
- Create: `tests/e2e/create-custom-template.spec.ts`

- [ ] **Step 6.1: Write the Playwright spec**

Create `tests/e2e/create-custom-template.spec.ts`. The next-intl runtime at `/create` returns translated English from `src/locales/en.json` (real provider, real bundle). So locator strings use the actual rendered English (e.g. "Custom", "+ Add category", "Create room"), NOT key paths.

```ts
import { test, expect } from "@playwright/test";

/**
 * Wizard custom-template E2E. Three cases, all single-window, fully
 * stubbed via page.route():
 *
 *  1. Selecting Custom expands the inline editor with one starter row.
 *  2. Adding rows up to 8 disables +Add; removing one re-enables it.
 *  3. Submitting Custom with valid rows POSTs {name, weight: 1} for
 *     every typed row.
 *
 * No seed-room, no realtime — the wizard is purely client-state +
 * a single POST /api/rooms on submit, which we intercept.
 */

const STUB_ROOM_ID = "11111111-2222-4333-8444-555566667777";
const STUB_USER_ID = "99999999-8888-4777-8666-555544443333";

const CONTESTANTS_PREVIEW = {
  count: 26,
  preview: [
    { flag: "🇸🇪", country: "Sweden" },
    { flag: "🇺🇦", country: "Ukraine" },
    { flag: "🇮🇹", country: "Italy" },
  ],
};

async function seedSession(page: import("@playwright/test").Page) {
  await page.addInitScript((userId) => {
    window.localStorage.setItem(
      "emx_session",
      JSON.stringify({
        userId,
        rejoinToken: "stub-rejoin-token",
        displayName: "Alice",
        avatarSeed: "alice",
        expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      }),
    );
  }, STUB_USER_ID);
}

async function stubContestants(page: import("@playwright/test").Page) {
  await page.route("**/api/contestants*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CONTESTANTS_PREVIEW),
    });
  });
}

test.describe("Wizard — custom template", () => {
  test("selecting Custom expands the editor with one starter row", async ({
    page,
  }) => {
    await stubContestants(page);
    await seedSession(page);
    await page.goto("/create");

    // Step 1 → Step 2
    await page.getByRole("button", { name: /Next/i }).click();

    // Custom card visible, editor not yet
    await expect(page.getByText("Custom", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Category name")).toHaveCount(0);

    // Click Custom to select + expand the editor
    await page.getByText("Custom", { exact: true }).click();

    await expect(page.getByPlaceholder("Category name")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /\+ Add category/i }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /Remove category 1/i }),
    ).toBeDisabled();
  });

  test("adding rows up to 8 disables +Add; removing one re-enables it", async ({
    page,
  }) => {
    await stubContestants(page);
    await seedSession(page);
    await page.goto("/create");
    await page.getByRole("button", { name: /Next/i }).click();
    await page.getByText("Custom", { exact: true }).click();

    const addButton = page.getByRole("button", { name: /\+ Add category/i });
    for (let i = 0; i < 7; i++) {
      await addButton.click();
    }
    await expect(page.getByPlaceholder("Category name")).toHaveCount(8);
    await expect(addButton).toBeDisabled();

    await page
      .getByRole("button", { name: /Remove category 8/i })
      .click();
    await expect(page.getByPlaceholder("Category name")).toHaveCount(7);
    await expect(addButton).toBeEnabled();
  });

  test("submitting Custom POSTs the entered names with weight=1", async ({
    page,
  }) => {
    await stubContestants(page);
    await seedSession(page);

    let capturedBody: unknown = null;
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() !== "POST") {
        return route.fallback();
      }
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          room: { id: STUB_ROOM_ID },
        }),
      });
    });

    await page.goto("/create");
    await page.getByRole("button", { name: /Next/i }).click();
    await page.getByText("Custom", { exact: true }).click();

    // Type into row 1
    const firstInput = page.getByPlaceholder("Category name").nth(0);
    await firstInput.fill("Vocals");

    // Add row 2 + fill
    await page.getByRole("button", { name: /\+ Add category/i }).click();
    const secondInput = page.getByPlaceholder("Category name").nth(1);
    await secondInput.fill("Stage Drama");

    await page.getByRole("button", { name: /Create room/i }).click();

    // Wait for the navigation + captured POST.
    await expect(page).toHaveURL(new RegExp(`/room/${STUB_ROOM_ID}`));

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as { categories: unknown };
    expect(body.categories).toEqual([
      { name: "Vocals", weight: 1 },
      { name: "Stage Drama", weight: 1 },
    ]);
  });
});
```

- [ ] **Step 6.2: Type-check the new spec**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 6.3: List the tests (sanity check)**

```bash
npx playwright test --list tests/e2e/create-custom-template.spec.ts
```

Expected: 3 tests listed.

- [ ] **Step 6.4: Commit**

```bash
git add tests/e2e/create-custom-template.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): Playwright spec for custom template in the create wizard

Three single-window cases, all page.route()-mocked (no seed-room, no
realtime, no Supabase env required):

1. Selecting Custom expands the inline editor with one starter row;
   +Add enabled; trash disabled on the only row.
2. Adding rows up to 8 disables +Add; removing one re-enables it.
3. Submitting Custom with two filled rows POSTs categories =
   [{name: 'Vocals', weight: 1}, {name: 'Stage Drama', weight: 1}].

Vitest covers per-row inline error rules (empty / too-short /
duplicate); Playwright pins the end-to-end happy path + the boundary
condition + the POST payload contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Pre-push verification gate

**Why last:** mandatory hard-gate before pushing. Both suites must pass green.

- [ ] **Step 7.1: Full vitest suite**

```bash
npm test
```

Expected: ALL tests PASS. This branch adds ~32 new cases: 12 in `validateCustomRow.test.ts`, 15 in `CustomTemplateCard.test.tsx`, 5 in `VotingConfig.test.tsx`. Project baseline + these new cases = full green.

If any non-passing test surfaces, STOP and report. Do not push.

- [ ] **Step 7.2: Start dev server on port 3457 for Playwright**

The Playwright `webServer` config has a 60s timeout that frequently misses Next.js cold starts. Start the dev server manually in the background and wait for it to be ready.

```bash
npm run dev -- --port 3457
```
(run in background)

Wait for readiness:

```bash
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3457/api/health | grep -q "200"; do sleep 2; done; echo "DEV_SERVER_READY"
```

- [ ] **Step 7.3: Full Playwright suite**

```bash
npx playwright test --reporter=list
```

Expected: ALL Playwright cases PASS. This branch adds 3 new cases (Wizard — custom template) on top of whatever's already on main.

If any case fails, STOP and report. Investigate trace via `npx playwright show-trace test-results/<failed-case>/trace.zip`. Do not push until all green.

- [ ] **Step 7.4: Stop the dev server**

```bash
kill $(lsof -ti:3457) 2>/dev/null || true
```

- [ ] **Step 7.5: Type-check + lint**

```bash
npm run type-check && npm run lint
```

Expected: PASS. Any NEW lint findings introduced by this branch are a blocker (pre-existing findings are not).

- [ ] **Step 7.6: Verify working tree is clean**

```bash
git status -s
```

Expected: empty output.

- [ ] **Step 7.7: Push + open PR**

Only after every previous gate is green:

```bash
git push -u origin feat/wizard-custom-template
```

Then open the PR with `gh pr create`. PR body should include:

- One-line summary of the slice
- Test counts (vitest + Playwright, both green)
- Manual smoke checklist:
  - Pick Custom, type 2 valid names, click Create → land on lobby with the typed categories
  - Type 1 character → see "At least 2 characters" inline error → Create stays disabled
  - Type two identical names (case-insensitive) → see "Already in your list" on the later row
  - Add 8 rows → +Add disables → remove one → re-enables
  - Switch Custom → Classic → Custom → typed rows persist
