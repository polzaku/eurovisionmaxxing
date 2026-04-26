# Phase S — compactness, slice 1 (S0 + S1)

**Date:** 2026-04-26
**Status:** Approved
**SPEC sections:** §6.1 (wizard Step 2 + lobby-edit), §13 (`room_memberships.scores_locked_at`)
**TODO references:** Phase S0 (schema migration), Phase S1 (wizard compactness)
**Closes:** Phase U A1, Phase U A3 (both already annotated as superseded by Phase S in TODO.md)

## 1. Goal

Land the prerequisite schema column (S0) and the compact, ⓘ-collapsible wizard cards (S1) in a single reviewable PR. This unblocks the larger Phase S2/S3/S4 work without committing to it now.

The voting card revamp (S2), the calibration drawer (S3), the post-`done` drill-downs (S4), and the corresponding locale follow-on (S5) are explicitly **out of scope** for this slice and will land as follow-up PRs.

## 2. Why these two together

- S0 is a one-line additive `ALTER TABLE`. Shipping it alone wastes a PR.
- S1 is a self-contained UI refactor with no API surface. It's small enough to bundle with S0 and large enough to justify a PR on its own.
- S2 (voting card) is much bigger and should not be lumped in.

## 3. Scope

### 3.1 In scope

**S0 — schema migration**
- Add `room_memberships.scores_locked_at TIMESTAMPTZ` (default NULL).
- Update `supabase/schema.sql` with the new column.
- Append a one-line note to `SUPABASE_SETUP.md`: re-apply schema; additive, no data loss.
- **No code path reads or writes the column in this slice.** It lands here purely as preparation for S3 (calibration drawer).

**S1 — wizard compactness**
- Extract two new components from `src/components/create/VotingConfig.tsx`:
  - `<TemplateCard>` — collapsed default; ⓘ expands inline categories + hints; single-open invariant within the template group.
  - `<AnnouncementModeCard>` — collapsed default; ⓘ expands the longer Live / Instant explainer; single-open invariant within the announcement-mode group.
- `<VotingConfig>` becomes a thin parent that owns the two "which card has its info expanded" pieces of state plus existing selection state.
- Locale keys in `src/locales/en.json` are re-used where they exist; new keys only when needed for the new structure (taglines, ⓘ button aria-label).
- Tests: unit tests on each new component (rendering by props, ⓘ click, selection click); update or replace the existing `VotingConfig` test if any (none currently exists for the wizard).

### 3.2 Out of scope

- **Custom template card** — the Custom builder (Phase U A5–A8) hasn't shipped. Custom remains filtered out of the wizard, same as today. The spec language about "four cards including Custom" is honored when the builder lands.
- **Lobby-edit consumer** — the lobby-edit surface itself doesn't exist yet. Components will live in `src/components/create/` for now, ready to be imported once lobby-edit lands. No second design.
- **"Now performing" toggle rename** — Phase R10 owns "Sync everyone to the performing act" copy. The toggle stays untouched here.
- **S2 voting-card compactness, S3 calibration drawer, S4 drill-downs, S5 locale follow-on.** Each is a separate PR.
- **Mobile vertical-budget snapshot test** — that test belongs to S2 (voting card), not the wizard.

## 4. Component design

### 4.1 `<TemplateCard>`

```tsx
interface TemplateCardProps {
  template: VotingTemplate;        // from src/lib/templates.ts
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;            // tap card body or CTA
  onToggleInfo: () => void;        // tap ⓘ; does NOT select
}
```

**Collapsed render (`expanded === false`):**
- Row 1: template name (bold) + ⓘ icon-button (top-right corner, 24×24 hit target).
- Row 2: one-line tagline (`description` from `VOTING_TEMPLATES`).
- Row 3: "Use this template" CTA — visually a button label, semantically part of the selection target.

**Expanded render (`expanded === true`):**
- Same three rows above PLUS the inline category + hint list (current ul/li from `VotingConfig`).
- ⓘ icon switches to "ⓘ open" visual state (e.g. filled vs outline).

**Selection visual:** when `selected === true`, border-primary + ring-primary/30 (matches existing pattern).

**Click semantics:**
- Card surface (anywhere except ⓘ) → `onSelect()`.
- ⓘ button → `event.stopPropagation()` + `onToggleInfo()`.
- CTA "Use this template" → `onSelect()` (parent of the card-surface click target).

**Keyboard:**
- Card is a `<button type="button">` (existing pattern).
- ⓘ is a nested `<button type="button">`. Browsers handle the nested-button edge-case via `stopPropagation`.

### 4.2 `<AnnouncementModeCard>`

```tsx
interface AnnouncementModeCardProps {
  mode: "live" | "instant";
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleInfo: () => void;
}
```

Same structure as `<TemplateCard>`, but:
- Collapsed: title + tagline + ⓘ. No CTA (radio cards don't need a separate selection affordance).
- Expanded: adds the long-form explainer (current `MODE_LABELS[m].copy` becomes the expanded copy; new short tagline goes in collapsed view).

**Tagline + long copy split (per SPEC §6.1):**
- Live tagline: *"Take turns announcing your points, Eurovision-style."*
- Live long: *"Great with a TV. Each user reveals their 1 → 12 in turn."*
- Instant tagline: *"Reveal the winner in one shot."*
- Instant long: *"Great if you're short on time. Everyone marks themselves ready, then the leaderboard appears."*

### 4.3 `<VotingConfig>` parent state

Two new pieces of state alongside existing selection state:

```tsx
const [expandedTemplateId, setExpandedTemplateId] = useState<TemplateId | null>(null);
const [expandedMode, setExpandedMode] = useState<Mode | null>(null);
```

`onToggleInfo` for a card flips its id in/out of the corresponding state, enforcing single-open within each group:

```tsx
const handleTemplateInfo = (id: TemplateId) =>
  setExpandedTemplateId((curr) => (curr === id ? null : id));
```

The two groups (templates, modes) are independent — opening a template's info does not collapse a mode's info.

### 4.4 File layout

```
src/components/create/
  VotingConfig.tsx          (now a thin parent)
  TemplateCard.tsx          (new)
  TemplateCard.test.tsx     (new)
  AnnouncementModeCard.tsx  (new)
  AnnouncementModeCard.test.tsx  (new)
```

`VotingConfig` itself doesn't get a test in this slice (it's mostly composition; the meaningful behavior is in the two card components). If the slice grows to need one, add it.

## 5. Locale keys

### 5.1 Existing keys reused

- `templates.{classic,spectacle,bangerTest,custom}.{name,description}` — already populated.
- `categories.*` — already populated.

### 5.2 New keys

- `templates.useThisTemplate` — "Use this template" CTA label.
- `templates.infoButtonAria` — aria-label for the ⓘ button on a template card. Param: `{name}` (template name).
- `templates.infoButtonAriaExpanded` — same, expanded state. (Optional — could reuse single key with `aria-expanded` attr instead. Picked: single key + `aria-expanded` for simplicity.)
- `announcementMode.live.tagline`, `announcementMode.live.long` — split current copy.
- `announcementMode.instant.tagline`, `announcementMode.instant.long` — split current copy.
- `announcementMode.infoButtonAria` — aria-label for the ⓘ on a mode card. Param: `{mode}`.

Updated `src/locales/locales.test.ts` expects the new keys per the established skip-empty-non-en convention. Non-`en` translations are deferred to Phase L L3.

## 6. Tests

### 6.1 `TemplateCard.test.tsx`

- **Collapsed render** — given `expanded={false}`, asserts:
  - Template name visible.
  - Tagline visible.
  - "Use this template" CTA visible.
  - Categories list NOT in the DOM.
- **Expanded render** — given `expanded={true}`, asserts categories+hints visible.
- **Selected visual** — given `selected={true}`, the wrapping element carries the selected class.
- **`onSelect` fires on card body click**, NOT on ⓘ click.
- **`onToggleInfo` fires on ⓘ click**, NOT `onSelect`.

### 6.2 `AnnouncementModeCard.test.tsx`

- Symmetric to `TemplateCard.test.tsx`:
  - Collapsed shows tagline only.
  - Expanded shows long copy.
  - Selection / ⓘ click semantics.

### 6.3 No new e2e or integration tests

The behavior change is entirely presentational. Existing wizard end-to-end coverage (none today) is not regressed. The `VotingConfig` parent is composition glue — exercising it would essentially re-test the cards.

## 7. Schema migration (S0)

### 7.1 SQL

```sql
ALTER TABLE room_memberships
  ADD COLUMN IF NOT EXISTS scores_locked_at TIMESTAMPTZ;
```

### 7.2 `supabase/schema.sql` patch

Add the column to the existing `CREATE TABLE room_memberships` block, with the same inline comment as SPEC §13:

```sql
scores_locked_at  TIMESTAMPTZ,                      -- soft lock-in for vote calibration (§8.10); NULL = unlocked / never locked. Cleared automatically on any vote write by this user.
```

(The "cleared automatically" wording reflects the *intended* future behavior — S3 will add the trigger / app-layer clear. In this slice, the column is unread.)

### 7.3 `SUPABASE_SETUP.md`

Append one paragraph under "Re-applying the schema":

> 2026-04-26 (Phase S0): added `room_memberships.scores_locked_at` (nullable TIMESTAMPTZ). Additive — no data loss. Re-apply by opening `supabase/schema.sql` in the SQL Editor and running. Idempotent: existing rows get NULL; future calibration-drawer logic (S3) populates and clears it.

### 7.4 No app-layer reads or writes

`runScoring`, votes-upsert, results read-path — none of these touch `scores_locked_at` in this slice. Greppable verification: after the change, `git grep scores_locked_at` should return only schema files and the SUPABASE_SETUP doc, no `src/`.

## 8. Verification before marking done

- `npm run type-check` — clean.
- `npm test` — all suites pass; new component tests added.
- `npm run lint` — clean.
- Manual: `npm run dev`, navigate to `/create`, advance to Step 2:
  - Verify all three predefined template cards render in compact form.
  - Verify ⓘ on each expands inline; opening a second collapses the first.
  - Verify selection still works (border highlight, persists when expanding ⓘ on the same or another card).
  - Verify both announcement-mode cards behave the same way.
  - Verify the "Now performing" toggle is unchanged.
- Schema: open `supabase/schema.sql` in the Supabase SQL Editor against a dev project, run, confirm no errors and that `\d room_memberships` shows the new column.

## 9. Rollback

- S1 is a pure UI refactor — revert by `git revert` of the slice's commits.
- S0 column is nullable and unread; safe to leave in place even if the slice is rolled back. (If you really want to drop it: `ALTER TABLE room_memberships DROP COLUMN scores_locked_at;` — additive→removal is also additive in the rollback direction since nothing reads it.)

## 10. Follow-ups (not part of this slice)

- **S2** — voting-card compactness (single-line rows, ⓘ hint collapse, scale ⓘ bottom-sheet, hot-take pill, mobile vertical-budget snapshot test).
- **S3** — calibration drawer (consumes `scores_locked_at`; adds the lock/unlock endpoints; surfaces the lock counter chip).
- **S4** — post-`done` drill-downs (`<ContestantDrillDown>`, `<ParticipantDrillDown>`, expanded HTML/PDF exports).
- **S5** — translate the new keys from S2/S3 plus this slice into es/uk/fr/de.
- **Phase U A5–A8** — Custom template builder; once shipped, the Custom card can be added to the wizard and this slice's ⓘ explainer text gets used.
- **Lobby-edit surface** — when built, imports `<TemplateCard>` and `<AnnouncementModeCard>` from `src/components/create/`; if the import location feels wrong at that point, hoist to `src/components/room-config/` then.
