# Phase S compactness slice 1 (S0 + S1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the additive `room_memberships.scores_locked_at` column (S0) and refactor the create-wizard's voting-config screen into compact, ⓘ-collapsible `<TemplateCard>` + `<AnnouncementModeCard>` components (S1).

**Architecture:** S0 is a one-line `ALTER TABLE` plus a doc note — no app reads or writes the column in this slice (S3 will consume it). S1 extracts the existing per-template / per-mode JSX from `VotingConfig.tsx` into two reusable card components driven by a single pure helper, `nextExpandedId<T>`, which enforces the spec's "only one info panel open at a time per group" invariant. Cards are placed in `src/components/create/` and will be imported from there when the lobby-edit surface lands.

**Tech Stack:** Next.js 14 + React 18, TypeScript strict, Tailwind, next-intl 3, Vitest (node environment — no DOM, so JSX components are manually verified; pure helpers get TDD unit tests, matching the existing repo pattern in `src/components/voting/{nextScore,scoredCount}.test.ts`).

**Spec:** [docs/superpowers/specs/2026-04-26-phase-s-compactness-slice-1-design.md](docs/superpowers/specs/2026-04-26-phase-s-compactness-slice-1-design.md)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/schema.sql` | Modify | Add `scores_locked_at TIMESTAMPTZ` column to `room_memberships` |
| `SUPABASE_SETUP.md` | Modify | Add a "Schema migrations" section with the 2026-04-26 entry |
| `src/locales/en.json` | Modify | Add `templates.useThisTemplate`, `templates.infoButtonAria`, `announcementMode.{live,instant}.{tagline,long}`, `announcementMode.infoButtonAria` |
| `src/components/create/expandedId.ts` | Create | Pure helper `nextExpandedId<T>(curr, clicked)` — single-open invariant |
| `src/components/create/expandedId.test.ts` | Create | Unit tests for `nextExpandedId` |
| `src/components/create/TemplateCard.tsx` | Create | Compact template card with ⓘ-expandable categories+hints |
| `src/components/create/AnnouncementModeCard.tsx` | Create | Compact announcement-mode radio card with ⓘ-expandable long copy |
| `src/components/create/VotingConfig.tsx` | Modify | Thin parent owning expansion + selection state; uses the two new cards |

No other files are touched. Greppable invariant after the slice: `git grep scores_locked_at` returns only `supabase/schema.sql`, `SUPABASE_SETUP.md`, and the spec/plan docs — no `src/` matches.

---

### Task 1: Schema migration + setup doc (S0)

**Files:**
- Modify: `supabase/schema.sql:60-66` (the `room_memberships` block)
- Modify: `SUPABASE_SETUP.md` — append new "Schema migrations" section after the "Step 6" / before "Keeping it alive"

- [ ] **Step 1: Add the column to `supabase/schema.sql`**

Replace the existing `room_memberships` block:

```sql
CREATE TABLE room_memberships (
  room_id     UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  is_ready    BOOLEAN DEFAULT FALSE,            -- for instant mode "ready to reveal"
  PRIMARY KEY (room_id, user_id)
);
```

with:

```sql
CREATE TABLE room_memberships (
  room_id           UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),
  joined_at         TIMESTAMPTZ DEFAULT NOW(),
  is_ready          BOOLEAN DEFAULT FALSE,            -- for instant mode "ready to reveal"
  scores_locked_at  TIMESTAMPTZ,                      -- soft lock-in for vote calibration (§8.10); NULL = unlocked / never locked. Cleared automatically on any vote write by this user.
  PRIMARY KEY (room_id, user_id)
);
```

- [ ] **Step 2: Add a "Schema migrations" section to `SUPABASE_SETUP.md`**

Insert this section between the "## Step 6: Run the app" section and the "## Keeping it alive (free tier)" section:

```markdown
---

## Schema migrations

The schema in `supabase/schema.sql` evolves. Migrations are **additive only** — no destructive changes — so re-applying the file is always safe (existing tables get new columns; existing data is preserved). To apply a migration: open `supabase/schema.sql` in the Supabase SQL Editor and run it.

### Changelog

| Date       | Change                                                                          | Re-apply needed? |
|------------|---------------------------------------------------------------------------------|------------------|
| 2026-04-26 | Added `room_memberships.scores_locked_at TIMESTAMPTZ` (Phase S0). NULL default. | Yes — additive.  |
```

- [ ] **Step 3: Sanity-check the SQL parses**

Run: `grep -c "scores_locked_at" supabase/schema.sql`
Expected: `1`

Run: `grep -c "Phase S0" SUPABASE_SETUP.md`
Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql SUPABASE_SETUP.md
git commit -m "$(cat <<'EOF'
schema: add room_memberships.scores_locked_at (Phase S0)

Additive nullable column for the Phase S3 calibration drawer's soft
lock-in. No app code reads or writes this column yet — S3 will be the
first consumer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Locale keys (en.json only)

**Files:**
- Modify: `src/locales/en.json` — add new keys under `templates` and `announcementMode` namespaces

`announcementMode` does not exist as a namespace yet — the current `MODE_LABELS` constant in `VotingConfig.tsx` carries hard-coded English. We're moving that copy into `en.json` and splitting it into `tagline` + `long`.

Other locale files (`es.json`, `uk.json`, `fr.json`, `de.json`) are intentionally empty stubs and skip the key-completeness assertion via the existing skip-empty rule in `locales.test.ts`. Don't add keys to them in this slice — Phase L L3 owns translations.

- [ ] **Step 1: Add keys to `src/locales/en.json`**

In the `templates` object, after the `custom` entry, add a sibling key (NOT nested):

```json
    "useThisTemplate": "Use this template",
    "infoButtonAria": "More about {name}"
```

So the `templates` block becomes:

```json
  "templates": {
    "classic":    { "name": "The Classic",     "description": "For fans who want to be fair and thorough." },
    "spectacle":  { "name": "The Spectacle",   "description": "For when you want to reward the unhinged." },
    "bangerTest": { "name": "The Banger Test", "description": "For when the group wants to find the actual best song." },
    "custom":     { "name": "Custom",          "description": "Build your own categories from scratch." },
    "useThisTemplate": "Use this template",
    "infoButtonAria": "More about {name}"
  },
```

(Reformat the four template entries to one line each only if you want the diff cleaner; keeping the original multi-line format is also fine. The key thing is the two new sibling keys.)

Add a new top-level `announcementMode` block immediately after `templates` and before `categories`:

```json
  "announcementMode": {
    "live": {
      "tagline": "Take turns announcing your points, Eurovision-style.",
      "long": "Great with a TV. Each user reveals their 1 → 12 in turn."
    },
    "instant": {
      "tagline": "Reveal the winner in one shot.",
      "long": "Great if you're short on time. Everyone marks themselves ready, then the leaderboard appears."
    },
    "infoButtonAria": "More about {mode} announcement mode"
  },
```

- [ ] **Step 2: Run the locale test to confirm it still passes**

Run: `npm test -- locales`
Expected: `1 passed | 4 todo` (the `en` self-check passes; the 4 non-en locales remain skipped).

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json
git commit -m "$(cat <<'EOF'
locale: add wizard compact-card keys (en) for Phase S1

New keys: templates.useThisTemplate, templates.infoButtonAria,
announcementMode.{live,instant}.{tagline,long},
announcementMode.infoButtonAria. Non-en translations deferred to Phase
L L3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `nextExpandedId` pure helper (TDD)

**Files:**
- Create: `src/components/create/expandedId.ts`
- Test: `src/components/create/expandedId.test.ts`

**Why a helper:** the spec's single-open invariant ("opening a second auto-collapses the first") needs the same "toggle / replace" logic in two places (template group, announcement-mode group). Pulling it out keeps the JSX dumb and gives us one focused unit test instead of weaving render-tests around it.

- [ ] **Step 1: Write the failing test**

Create `src/components/create/expandedId.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextExpandedId } from "./expandedId";

describe("nextExpandedId", () => {
  it("opens a card when nothing is open", () => {
    expect(nextExpandedId(null, "classic")).toBe("classic");
  });

  it("collapses the open card when its own id is clicked again", () => {
    expect(nextExpandedId("classic", "classic")).toBeNull();
  });

  it("switches to a different card when another id is clicked", () => {
    expect(nextExpandedId("classic", "spectacle")).toBe("spectacle");
  });

  it("is generic — works with arbitrary string-tag types", () => {
    type Mode = "live" | "instant";
    const result: Mode | null = nextExpandedId<Mode>(null, "live");
    expect(result).toBe("live");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- expandedId`
Expected: FAIL — `Cannot find module './expandedId'` or similar.

- [ ] **Step 3: Implement the helper**

Create `src/components/create/expandedId.ts`:

```ts
export function nextExpandedId<T>(curr: T | null, clicked: T): T | null {
  return curr === clicked ? null : clicked;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- expandedId`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/create/expandedId.ts src/components/create/expandedId.test.ts
git commit -m "$(cat <<'EOF'
voting-config: nextExpandedId pure helper for single-open invariant

Generic toggle helper used by Phase S1's template + announcement-mode
card groups: opening a different card replaces the previously open
one; clicking the open card collapses it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `<TemplateCard>` + `<AnnouncementModeCard>` + `<VotingConfig>` refactor

**Files:**
- Create: `src/components/create/TemplateCard.tsx`
- Create: `src/components/create/AnnouncementModeCard.tsx`
- Modify: `src/components/create/VotingConfig.tsx` — replace inline card markup with the new components

**Single coupled commit.** The cards aren't useful without the parent rewiring; the parent rewiring breaks the type-check until the cards exist. We land all three together so the worktree is type-check-clean at every commit boundary.

**Component testing posture:** the repo's vitest environment is `node` (see `vitest.config.ts`) and no `@testing-library/react` is installed. JSX components in this codebase are manually verified in `npm run dev`; only pure helpers get unit tests. Don't add testing-library here — that's a separate decision out of scope for this slice. Manual smoke test in Step 7.

- [ ] **Step 1: Create `<TemplateCard>`**

Create `src/components/create/TemplateCard.tsx`:

```tsx
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
  const name = t(template.nameKey);
  const description = t(template.descriptionKey);

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
        <p className="text-sm font-medium text-primary pt-1">
          {t("templates.useThisTemplate")}
        </p>
        {expanded && (
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground border-t border-border pt-3">
            {template.categories.map((c) => (
              <li key={c.key}>
                <span className="font-medium text-foreground">
                  {t(c.nameKey)}
                </span>
                {c.hintKey ? <> &mdash; {t(c.hintKey)}</> : null}
              </li>
            ))}
          </ul>
        )}
      </button>
    </div>
  );
}
```

**Why `<span role="button">` instead of nested `<button>`:** nested `<button>` elements are invalid HTML and cause inconsistent event behavior across browsers. The outer `<button>` owns the card-body click; the ⓘ is a `<span>` with `role="button"` + keyboard handlers, which is the established escape hatch when you need a clickable region inside a button.

- [ ] **Step 2: Create `<AnnouncementModeCard>`**

Create `src/components/create/AnnouncementModeCard.tsx`:

```tsx
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
```

**Why hard-coded `TITLES` instead of locale keys:** the words "Live" and "Instant" are the technical identifiers of the two modes (not user-facing prose) and currently exist as hard-coded strings in `VotingConfig`. If we want them translated, that's a Phase L L1 follow-on — not in scope for this slice. Mirroring the current behavior keeps the diff focused.

- [ ] **Step 3: Refactor `<VotingConfig>` to use the new cards**

Replace the entire contents of `src/components/create/VotingConfig.tsx` with:

```tsx
"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { VOTING_TEMPLATES } from "@/lib/templates";
import TemplateCard from "./TemplateCard";
import AnnouncementModeCard from "./AnnouncementModeCard";
import { nextExpandedId } from "./expandedId";

type TemplateId = "classic" | "spectacle" | "banger";
type Mode = "live" | "instant";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

interface VotingConfigProps {
  templateId: TemplateId;
  announcementMode: Mode;
  allowNowPerforming: boolean;
  submitState: SubmitState;
  onChange: (patch: {
    templateId?: TemplateId;
    announcementMode?: Mode;
    allowNowPerforming?: boolean;
  }) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export default function VotingConfig({
  templateId,
  announcementMode,
  allowNowPerforming,
  submitState,
  onChange,
  onBack,
  onSubmit,
}: VotingConfigProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [expandedTemplateId, setExpandedTemplateId] =
    useState<TemplateId | null>(null);
  const [expandedMode, setExpandedMode] = useState<Mode | null>(null);

  const templates = VOTING_TEMPLATES.filter((t) => t.id !== "custom");
  const submitting = submitState.kind === "submitting";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">Voting setup</h2>
        <p className="text-sm text-muted-foreground">
          Pick a template and how you want results revealed.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Template</p>
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
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Announcement</p>
        <div className="grid grid-cols-1 gap-2">
          {(["live", "instant"] as Mode[]).map((m) => (
            <AnnouncementModeCard
              key={m}
              mode={m}
              selected={m === announcementMode}
              expanded={expandedMode === m}
              onSelect={() => onChange({ announcementMode: m })}
              onToggleInfo={() =>
                setExpandedMode((curr) => nextExpandedId(curr, m))
              }
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allowNowPerforming}
            onChange={(e) =>
              onChange({ allowNowPerforming: e.target.checked })
            }
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span className="space-y-1">
            <span className="text-sm font-medium flex items-center gap-2">
              Sync everyone to the performing act
              <button
                type="button"
                aria-label="About this toggle"
                onClick={(e) => {
                  e.preventDefault();
                  setInfoOpen((v) => !v);
                }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                i
              </button>
            </span>
            {infoOpen && (
              <span className="block text-xs text-muted-foreground">
                Lets you tap the currently-performing country to bring all
                guests to that card during voting. Off by default.
              </span>
            )}
          </span>
        </label>
      </div>

      {submitState.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {submitState.message}
        </p>
      )}

      <div className="flex justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "Creating…" : "Create room"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run type-check**

Run: `npm run type-check`
Expected: clean exit (0). If it errors on `VotingTemplate`, check the import — `@/types` is the established alias.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all suites pass. The new `expandedId` test runs alongside; no existing test references `VotingConfig`'s internals so refactoring it is safe.

- [ ] **Step 6: Manual smoke test in dev server**

Run: `npm run dev`
Then in a browser, navigate to `http://localhost:3000/create`.

Verify (record any deviation):
1. Step 1 (event selection) renders normally → click "Next".
2. Step 2 renders three template cards (Classic, Spectacle, Banger Test) in compact form. Each shows: name + tagline + ⓘ (top-right) + "Use this template" CTA.
3. **Selection**: tap a card body → border + ring highlight that card. Tapping a different card moves the highlight; categories list does NOT auto-expand.
4. **ⓘ behavior**: tap ⓘ on Card A → its categories+hints expand inline. Tap ⓘ on Card B → A's info collapses, B's expands. Tap ⓘ on B again → B collapses (none expanded).
5. **Selection ≠ expansion**: tapping ⓘ does NOT change which card is selected. Tapping the card body does NOT auto-expand.
6. Two announcement-mode cards (Live, Instant) render with same structure: title + tagline + ⓘ. Selection + ⓘ behave the same as templates.
7. The "Sync everyone to the performing act" toggle is unchanged in appearance and behavior.
8. Click "Create room" → wizard advances normally. Room is created with the selected template + announcement mode.

If any step deviates, abort the commit, fix, re-verify.

- [ ] **Step 7: Commit**

```bash
git add src/components/create/TemplateCard.tsx src/components/create/AnnouncementModeCard.tsx src/components/create/VotingConfig.tsx
git commit -m "$(cat <<'EOF'
voting-config: compact wizard cards with ⓘ-expand (Phase S1)

Extract <TemplateCard> + <AnnouncementModeCard> from VotingConfig.
Cards default to compact (name + tagline + ⓘ + CTA); ⓘ expands inline
detail. Single-open invariant per group via nextExpandedId helper.
Closes Phase U A1 + A3.

Custom template builder is still Phase U A5–A8 work; the Custom card
remains filtered out of the wizard for now (same as before).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Final verification

**Files:** none modified.

- [ ] **Step 1: Type-check**

Run: `npm run type-check`
Expected: clean exit (0).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean exit (0). Address any new warnings introduced by Tasks 3/4 inline.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all suites pass; new `expandedId` test included; no regressions.

- [ ] **Step 4: Confirm the no-app-reads invariant for `scores_locked_at`**

Run: `git grep scores_locked_at -- 'src/**'`
Expected: no matches. The column is referenced only in `supabase/schema.sql`, `SUPABASE_SETUP.md`, and the docs.

- [ ] **Step 5: Confirm clean git state**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

Run: `git log --oneline main..HEAD`
Expected: 4 commits — Task 1 (schema), Task 2 (locale), Task 3 (helper + test), Task 4 (cards + refactor). Plus the spec commit from before this plan started.

- [ ] **Step 6: Update TODO.md (root tree)**

Switch to the main worktree (`cd /Users/valeriiakulynych/Projects/eurovisionmaxxing`) and edit `TODO.md` to tick the Phase S0 + Phase S1 items completed by this slice. Specifically tick these lines under "### S0 — Schema migration (additive)" and "### S1 — Wizard compactness":

- `[x] Add room_memberships.scores_locked_at TIMESTAMPTZ` (default NULL)…
- `[x] Update supabase/schema.sql with the new column;`…
- `[x] Step 2 template cards: compact default…`
- `[x] Step 2 announcement-mode radio cards: one-line tagline + ⓘ…`
- `[x] Phase U items A1 + A3 are now closed — work tracked here.`

Leave the lobby-edit reuse line (`[ ] Lobby-edit reuses the **same** compact card components`) **unticked** — that surface doesn't exist yet.

`TODO.md` is gitignored — don't try to commit it.

- [ ] **Step 7: Stop here**

The slice is complete. Hand off to the user with a one-line summary: 4 commits on `feat/phase-s-compactness` ready for review / PR. Do NOT push or open a PR — that's a user decision.

---

## Self-Review

**Spec coverage:**
- §3.1 In scope → S0 schema ✅ (Task 1), TemplateCard ✅ (Task 4), AnnouncementModeCard ✅ (Task 4), VotingConfig parent ✅ (Task 4), locale keys ✅ (Task 2), pure helper test ✅ (Task 3).
- §3.2 Out of scope → none touched (verified: no Custom card, no lobby-edit, no S2/S3 work, no vertical-budget test, no toggle rename).
- §4.1 TemplateCard prop signature → matches Task 4 Step 1 verbatim.
- §4.2 AnnouncementModeCard prop signature → matches Task 4 Step 2 verbatim.
- §4.3 single-open invariant → enforced by `nextExpandedId` (Task 3) consumed in VotingConfig (Task 4 Step 3).
- §5.2 new locale keys → all six keys added in Task 2 Step 1.
- §6 tests → repo testing posture (pure-functions only) is preserved; helper test in Task 3; cards manually smoke-tested in Task 4 Step 6. Spec §6.1/6.2's "TemplateCard.test.tsx / AnnouncementModeCard.test.tsx" are NOT created — that conflicts with the no-DOM vitest setup. Resolution: the spec assumed a DOM testing harness; the plan adapts to the repo's actual posture by extracting the testable invariant (`nextExpandedId`) and manually verifying the JSX. **Documented in Task 4 preamble.** This is a deliberate, explicit deviation.
- §7 schema → Task 1 covers SQL + schema.sql + SUPABASE_SETUP.
- §8 verification → Task 5.
- §9 rollback → covered by individual commit boundaries; not a separate task.
- §10 follow-ups → not implemented (correctly).

**Placeholder scan:** none of "TBD", "TODO", "implement later", "fill in details", or "Add appropriate error handling" appear in the plan. All code blocks are complete.

**Type consistency:**
- `TemplateId` = `"classic" | "spectacle" | "banger"` — matches existing usage in `VotingConfig`.
- `Mode` = `"live" | "instant"` — matches existing usage.
- `nextExpandedId<T>(curr: T | null, clicked: T): T | null` — used identically in both `setExpandedTemplateId(curr => nextExpandedId(curr, ...))` and `setExpandedMode(curr => nextExpandedId(curr, ...))`. Generic widens cleanly.
- `VotingTemplate` imported from `@/types` in both `TemplateCard` and `VotingConfig` — same alias as the existing import.
- `template.nameKey`, `template.descriptionKey`, `c.nameKey`, `c.hintKey` — all exist on the actual `VOTING_TEMPLATES` data per `src/lib/templates.ts`.

**Spec deviation summary (one item):** see §6 above — the spec's "two `.test.tsx` files" become "one pure-helper test + manual smoke" because the repo lacks a DOM testing harness. This was the right call given the existing pattern (every component test in this repo is currently `.test.ts` for a pure function); introducing testing-library is its own decision out of scope. If the user wants the heavier coverage, that's a separate slice.
